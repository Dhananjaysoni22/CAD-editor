import React, { Suspense, useMemo, useState, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF, OrthographicCamera, MapControls, Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { useStore } from '../store';

import axios from 'axios';

function Model({ url, onLoadMinY }) {
  const { scene } = useGLTF(url);
  const setSimulationData = useStore(state => state.setSimulationData);

  useEffect(() => {
    if (scene) {
      const grid = 50;
      const points = new Set();
      const vec = new THREE.Vector3();
      const matrix = new THREE.Matrix4();
      
      scene.updateMatrixWorld(true);
      
      const meshGroups = [];
      let globalMinY = Infinity;
      
      scene.traverse((child) => {
        if (child.isMesh) {
          const pos = child.geometry.attributes.position;
          if (!pos) return;
          
          const points = new Set();
          
          const extractPoints = (m) => {
             for (let i = 0; i < pos.count; i++) {
                 vec.fromBufferAttribute(pos, i).applyMatrix4(m);
                 if (vec.y < globalMinY) globalMinY = vec.y;
                 const x = Math.round(vec.x / grid) * grid;
                 const z = Math.round(vec.z / grid) * grid;
                 points.add(`${x},${z}`);
             }
          };
          
          if (child.isInstancedMesh) {
            for (let inst = 0; inst < child.count; inst++) {
               child.getMatrixAt(inst, matrix);
               matrix.premultiply(child.matrixWorld);
               extractPoints(matrix);
            }
          } else {
             extractPoints(child.matrixWorld);
          }
          
          if (points.size > 0) {
            const groupPayload = Array.from(points).map(p => {
              const [x, z] = p.split(',');
              return [parseFloat(x), parseFloat(z)];
            });
            meshGroups.push(groupPayload);
          }
        }
      });
      
      if (onLoadMinY && globalMinY !== Infinity) {
          onLoadMinY(globalMinY);
      }
      
      const setIsLoading = useStore.getState().setIsLoading;
      if (meshGroups.length > 0) {
          axios.post('http://localhost:8000/generate-safezone', { mesh_groups: meshGroups })
            .then(res => {
              if (res.data.error) {
                  alert("Backend Error: " + res.data.error);
              } else {
                  setSimulationData(res.data);
              }
            })
            .catch(err => {
               console.error("Failed to generate footprint", err);
               alert("Failed to generate footprint");
            })
            .finally(() => {
               setIsLoading(false);
            });
      } else {
          setIsLoading(false);
      }
    }
  }, [scene, setSimulationData]);

  return <primitive object={scene} scale={[1000, 1000, 1000]} />;
}

function PolygonLine({ points, color, lineWidth, dashed }) {
  const points3D = useMemo(() => {
    if (!points || points.length === 0) return [];
    const pts = points.map(p => [p[0], 0, p[1]]);
    
    // Ensure the polygon line is visually closed
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first[0] !== last[0] || first[2] !== last[2]) {
      pts.push([...first]);
    }
    
    return pts;
  }, [points]);

  if (points3D.length === 0) return null;

  return (
    <Line 
      points={points3D} 
      color={color} 
      lineWidth={lineWidth} 
      dashed={dashed}
      dashSize={dashed ? 100 : 0}
      gapSize={dashed ? 100 : 0}
    />
  );
}

function SafeZoneMesh({ points, yOffset = 0 }) {
  const shape = useMemo(() => {
    if (!points || points.length === 0) return null;
    const s = new THREE.Shape();
    // THREE.Shape operates in X,Y coordinates. We will rotate the mesh to lay it flat in X,Z.
    s.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      s.lineTo(points[i][0], points[i][1]);
    }
    return s;
  }, [points]);

  if (!shape) return null;

  return (
    <mesh position={[0, yOffset, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial color="#3b82f6" transparent opacity={0.3} side={THREE.DoubleSide} />
    </mesh>
  );
}

function ExporterHook({ exportGroupRef }) {
  const setExportModel = useStore(state => state.setExportModel);
  
  useEffect(() => {
    setExportModel(() => {
      if (!exportGroupRef.current) return;
      const exporter = new GLTFExporter();
      exporter.parse(
        exportGroupRef.current,
        (gltf) => {
          const blob = new Blob([gltf], { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'park-model-with-safezone.glb';
          a.click();
          URL.revokeObjectURL(url);
        },
        (err) => {
          console.error("Export failed:", err);
          alert("Export failed!");
        },
        { binary: true }
      );
    });
  }, [exportGroupRef, setExportModel]);
  
  return null;
}

function SelectionLogic({ setBoxUi }) {
  const { camera, gl } = useThree();
  const footprint = useStore(state => state.footprint);
  const selectedEdges = useStore(state => state.selectedEdges);
  const setSelectedEdges = useStore(state => state.setSelectedEdges);
  const toggleEdgeSelection = useStore(state => state.toggleEdgeSelection);

  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = gl.domElement;
    
    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      isDragging.current = true;
      startPos.current = { x, y };
      setBoxUi({ startX: x, startY: y, endX: x, endY: y });
    };

    const onPointerMove = (e) => {
      if (!isDragging.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setBoxUi(prev => {
        if (!prev) return prev;
        return { ...prev, endX: x, endY: y };
      });
    };

    const onPointerUp = (e) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      
      const rect = canvas.getBoundingClientRect();
      const endX = e.clientX - rect.left;
      const endY = e.clientY - rect.top;
      const startX = startPos.current.x;
      const startY = startPos.current.y;
      
      setBoxUi(null);

      if (Math.abs(endX - startX) < 5 && Math.abs(endY - startY) < 5) {
         return;
      }

      const minX = Math.min(startX, endX);
      const maxX = Math.max(startX, endX);
      const minY = Math.min(startY, endY);
      const maxY = Math.max(startY, endY);

      const newlySelected = [];
      const vec = new THREE.Vector3();

      for (let i = 0; i < footprint.length; i++) {
        const p1 = footprint[i];
        const p2 = footprint[(i + 1) % footprint.length];
        const midX = (p1[0] + p2[0]) / 2;
        const midZ = (p1[1] + p2[1]) / 2;
        
        vec.set(midX, 0, midZ);
        vec.project(camera);
        
        // Convert NDC back to canvas-relative coordinates
        const px = (vec.x + 1) / 2 * rect.width;
        const py = (-vec.y + 1) / 2 * rect.height;
        
        if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
          newlySelected.push(i);
        }
      }
      
      if (e.shiftKey) {
         const merged = new Set([...useStore.getState().selectedEdges, ...newlySelected]);
         setSelectedEdges(Array.from(merged));
      } else {
         setSelectedEdges(newlySelected);
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [camera, gl, footprint, setBoxUi, setSelectedEdges]);

  return null;
}

function SafeZoneSegments() {
  const safeZone = useStore(state => state.safeZone);
  const footprint = useStore(state => state.footprint);
  const offsets = useStore(state => state.offsets);
  const selectedEdges = useStore(state => state.selectedEdges);
  const toggleEdgeSelection = useStore(state => state.toggleEdgeSelection);
  const isMeshMode = useStore(state => state.isMeshMode);

  if (!safeZone || safeZone.length === 0 || !footprint || footprint.length === 0) return null;

  const segments = [];
  for (let i = 0; i < footprint.length; i++) {
    const p1 = footprint[i];
    const p2 = footprint[(i + 1) % footprint.length];
    
    const midX = (p1[0] + p2[0]) / 2;
    const midZ = (p1[1] + p2[1]) / 2;
    
    const dx = p2[0] - p1[0];
    const dz = p2[1] - p1[1];
    const len = Math.hypot(dx, dz);
    let nx = 0, nz = 0;
    if (len > 0) {
      nx = dz / len;
      nz = -dx / len;
    }
    
    const isSelected = selectedEdges.includes(i);
    const offsetDist = offsets[i] || 1500;
    
    const showLabel = isSelected;

    segments.push(
      <group key={`edge-${i}`}>
        <Line 
          points={[[p1[0], 0, p1[1]], [p2[0], 0, p2[1]]]}
          color={isSelected ? "#fbbf24" : "rgba(255,255,255,0.4)"}
          lineWidth={isSelected ? 6 : 3}
          onClick={(e) => {
            e.stopPropagation();
            toggleEdgeSelection(i, e.shiftKey);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'default';
          }}
        />
        
        {showLabel && (
          <>
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  count={2}
                  array={new Float32Array([midX, 5, midZ, midX + nx * offsetDist, 5, midZ + nz * offsetDist])}
                  itemSize={3}
                />
              </bufferGeometry>
              <lineBasicMaterial color="rgba(255, 255, 255, 0.5)" linewidth={1} />
            </line>
            
            <mesh position={[midX + nx * offsetDist, 5, midZ + nz * offsetDist]}>
              <circleGeometry args={[20, 16]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>

            <Html position={[midX + nx * (offsetDist + 400), 0, midZ + nz * (offsetDist + 400)]} center zIndexRange={[100, 0]}>
              <div 
                style={{
                  background: isSelected ? '#fbbf24' : 'rgba(0,0,0,0.7)',
                  color: isSelected ? '#000' : '#fff',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  border: isSelected ? 'none' : '1px solid rgba(255,255,255,0.2)'
                }}
              >
                {offsetDist} mm
              </div>
            </Html>
          </>
        )}
      </group>
    );
  }

  return (
    <group>
      {isMeshMode ? (
        <SafeZoneMesh points={safeZone} />
      ) : (
        <PolygonLine points={safeZone} color="#3b82f6" lineWidth={4} />
      )}
      {segments}
    </group>
  );
}

export default function Viewer() {
  const modelUrl = useStore(state => state.modelUrl);
  const safeZone = useStore(state => state.safeZone);
  const isMeshMode = useStore(state => state.isMeshMode);
  const [boxUi, setBoxUi] = useState(null);
  const [modelMinY, setModelMinY] = useState(0);
  const exportGroupRef = useRef();

  return (
    <div className="canvas-container" onPointerDown={(e) => {
        // If clicking on background, clear selection
        if (e.target.tagName === 'CANVAS') {
           useStore.getState().setSelectedEdges([]);
        }
    }}>
      <Canvas>
        <color attach="background" args={['#0b0f19']} />
        
        <OrthographicCamera 
          makeDefault 
          position={[0, 10000, 0]} 
          zoom={0.1} 
          near={0.1} 
          far={100000} 
        />
        
        <MapControls 
          enableRotate={false} 
          mouseButtons={{
            LEFT: THREE.MOUSE.NONE, // Left click is used for Box Selection and Clicking Lines
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN // Right click to Pan
          }}
        />

        <ambientLight intensity={0.5} />
        <directionalLight position={[1000, 1000, 500]} intensity={1} />
        
        <ExporterHook exportGroupRef={exportGroupRef} />

        <group ref={exportGroupRef}>
          {modelUrl && (
            <Suspense fallback={null}>
              <Model url={modelUrl} onLoadMinY={(min) => setModelMinY(min)} />
            </Suspense>
          )}
          {isMeshMode && safeZone.length > 0 && (
            <SafeZoneMesh points={safeZone} yOffset={modelMinY - 5} />
          )}
        </group>

        <SelectionLogic setBoxUi={setBoxUi} />
        <SafeZoneSegments />
        
        <gridHelper args={[100000, 100, '#1f2937', '#111827']} />
      </Canvas>

      {/* Render the 2D Selection Box */}
      {boxUi && (
        <div style={{
          position: 'absolute',
          left: Math.min(boxUi.startX, boxUi.endX),
          top: Math.min(boxUi.startY, boxUi.endY),
          width: Math.abs(boxUi.endX - boxUi.startX),
          height: Math.abs(boxUi.endY - boxUi.startY),
          border: '1px solid rgba(59, 130, 246, 0.8)',
          backgroundColor: 'rgba(59, 130, 246, 0.2)',
          pointerEvents: 'none',
          zIndex: 1000
        }} />
      )}
      
      {/* Help Overlay */}
      <div style={{
        position: 'absolute',
        bottom: 20, right: 20,
        background: 'rgba(0,0,0,0.5)',
        padding: '10px 15px',
        borderRadius: '8px',
        color: '#94a3b8',
        fontSize: '12px',
        pointerEvents: 'none'
      }}>
        Left-click + Drag to select area • Right-click + Drag to pan
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import axios from 'axios';
import { Upload, Settings, Download } from 'lucide-react';
import { useStore } from '../store';

export default function Sidebar() {
  const [customOffset, setCustomOffset] = useState('');
  
  const setModelUrl = useStore(state => state.setModelUrl);
  const setSimulationData = useStore(state => state.setSimulationData);
  const updateSafeZone = useStore(state => state.updateSafeZone);
  const updateOffset = useStore(state => state.updateOffset);
  
  const footprint = useStore(state => state.footprint);
  const offsets = useStore(state => state.offsets);
  const selectedEdges = useStore(state => state.selectedEdges);
  const isLoading = useStore(state => state.isLoading);
  const setIsLoading = useStore(state => state.setIsLoading);
  const isMeshMode = useStore(state => state.isMeshMode);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Set local blob URL for 3D viewer
    const objectUrl = URL.createObjectURL(file);
    setModelUrl(objectUrl);
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await axios.post('http://localhost:8000/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      if (res.data.error) {
        alert("Backend Error: " + res.data.error);
        setIsLoading(false);
      } else {
        // We do NOT call setSimulationData here anymore.
        // Viewer.jsx will parse the scene, extract the vertices,
        // and call /generate-safezone, which will set the simulation data!
        // So we keep loading true until Viewer finishes!
      }
    } catch (err) {
      console.error(err);
      alert("Failed to upload model.");
      setIsLoading(false);
    }
  };

  const handleApplyOffset = async () => {
    if (selectedEdges.length === 0 || customOffset === '') return;
    
    const val = parseFloat(customOffset);
    if (isNaN(val)) return;

    setIsLoading(true);
    
    updateOffset(selectedEdges, val);
    
    const currentOffsets = useStore.getState().offsets;

    try {
      const res = await axios.post('http://localhost:8000/recalculate-offset', {
        footprint: footprint,
        offsets: currentOffsets
      });
      
      if (res.data.error) {
        alert("Backend Error: " + res.data.error);
      } else {
        updateSafeZone(res.data.safeZone);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to recalculate offset.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = () => {
    const data = {
      footprint,
      offsets,
      safeZone: useStore.getState().safeZone
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'park-planning-data.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>Park Planner CAD</h1>
      </div>
      
      <div className="panel-section">
        <h2>1. Upload Model</h2>
        <label className="upload-btn">
          <Upload size={18} />
          <span>Select GLB File</span>
          <input type="file" className="upload-input" accept=".glb" onChange={handleFileUpload} />
        </label>
      </div>

      {footprint.length > 0 && (
        <div className="panel-section">
          <h2>2. Edge Editor</h2>
          {selectedEdges.length > 0 ? (
            <div className="edge-editor">
              <div className="edge-info">
                <span>Selected Edges: {selectedEdges.length}</span>
                {selectedEdges.length === 1 && <span>Current: {offsets[selectedEdges[0]]}mm</span>}
              </div>
              <div className="input-group">
                <label>New Offset (mm)</label>
                <input 
                  type="number" 
                  value={customOffset} 
                  onChange={(e) => setCustomOffset(e.target.value)}
                  placeholder="e.g. 2500"
                />
              </div>
              <button className="action-btn primary" onClick={handleApplyOffset}>
                Apply & Recalculate
              </button>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              Shift-click or drag a box over footprint edges to modify their safety distance.
            </div>
          )}
        </div>
      )}

      {footprint.length > 0 && (
        <div className="panel-section" style={{ marginTop: 'auto' }}>
          <h2>Export Data</h2>
          <button 
            className="action-btn" 
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '10px' }} 
            onClick={() => useStore.getState().toggleMeshMode()}
          >
            {isMeshMode ? "Revert to Line" : "Convert to Mesh"}
          </button>
          
          <button 
            className="action-btn primary" 
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '10px' }} 
            onClick={() => {
               const exportFn = useStore.getState().exportModel;
               if (exportFn) exportFn();
            }}
          >
            <Download size={18} /> Export 3D GLB
          </button>

          <button 
            className="action-btn" 
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} 
            onClick={handleDownload}
          >
            <Download size={18} /> Download JSON
          </button>
        </div>
      )}

      {isLoading && (
        <div className="loader-overlay">
          <div className="spinner"></div>
          <div>Processing geometry...</div>
        </div>
      )}
    </div>
  );
}

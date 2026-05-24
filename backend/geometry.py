import math
from typing import List, Tuple, Dict
import numpy as np
from shapely.geometry import Polygon, MultiPolygon, LineString, Point
from shapely.ops import unary_union
import trimesh

def load_footprint_from_glb(file_path: str) -> Polygon:
    """
    Loads a GLB file and extracts a detailed 2D footprint polygon.
    """
    # Force loading as a scene to access the scene graph
    scene = trimesh.load(file_path, force='scene')
    
    dumped = scene.dump()
    if not isinstance(dumped, (list, tuple, np.ndarray)):
        dumped = [dumped]
        
    all_vertices = []
    
    for mesh in dumped:
        if not isinstance(mesh, trimesh.Trimesh):
            continue
            
        # Scale to mm
        mesh.apply_scale(1000.0)
        v2d = mesh.vertices[:, [0, 2]]
        all_vertices.append(v2d)
        
    if not all_vertices:
        raise ValueError("Could not extract a 2D footprint. The model has no vertices.")
        
    import shapely
    from shapely.geometry import MultiPoint
    
    # Concatenate all vertices
    v2d_all = np.concatenate(all_vertices)
    
    # Downsample points by rounding to nearest 50mm grid.
    # This reduces hundreds of thousands of points to just a few thousand for extremely fast processing.
    v2d_rounded = np.round(v2d_all / 50.0) * 50.0
    unique_v2d = np.unique(v2d_rounded, axis=0)
    
    mp = MultiPoint(unique_v2d)
    
    # Generate a tight perimeter wrapping the points
    footprint = shapely.concave_hull(mp, ratio=0.1)
    
    if footprint.is_empty or footprint.geom_type not in ['Polygon', 'MultiPolygon']:
         footprint = mp.convex_hull
         
    # Clean up jagged edges from the grid snap and create smooth CAD-like lines
    simplified = footprint.buffer(50).simplify(100)
    
    if simplified.geom_type == 'MultiPolygon':
        simplified = max(simplified.geoms, key=lambda a: a.area)
        
    return simplified

def apply_variable_offset(base_polygon: Polygon, edge_offsets: List[float]) -> Polygon:
    """
    Applies a variable offset to a polygon. 
    base_polygon: The Shapely Polygon (exterior coordinates).
    edge_offsets: A list of floats representing the offset distance for each edge.
                  The length of edge_offsets must match the number of edges.
                  
    Returns: A new Polygon representing the offset boundary.
    """
    import shapely
    coords = list(base_polygon.exterior.coords)
    if coords[0] == coords[-1]:
        coords = coords[:-1]
        
    n = len(coords)
    if len(edge_offsets) != n:
        edge_offsets = [1500.0] * n
        
    is_ccw = shapely.is_ccw(base_polygon.exterior)
    
    offset_lines = []
    for i in range(n):
        p1 = np.array(coords[i])
        p2 = np.array(coords[(i + 1) % n])
        
        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]
        length = math.hypot(dx, dy)
        if length == 0:
            offset_lines.append((p1, p2))
            continue
            
        if is_ccw:
            nx = dy / length
            ny = -dx / length
        else:
            nx = -dy / length
            ny = dx / length
            
        dist = edge_offsets[i]
        new_p1 = p1 + np.array([nx, ny]) * dist
        new_p2 = p2 + np.array([nx, ny]) * dist
        
        offset_lines.append((new_p1, new_p2))
        
    def get_intersection(p1, p2, p3, p4):
        x1, y1 = p1[0], p1[1]
        x2, y2 = p2[0], p2[1]
        x3, y3 = p3[0], p3[1]
        x4, y4 = p4[0], p4[1]
        den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if abs(den) < 1e-8:
            return None
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

    new_vertices = []
    for i in range(n):
        l1 = offset_lines[i - 1]
        l2 = offset_lines[i]
        orig_v = coords[i]
        
        intersect = get_intersection(l1[0], l1[1], l2[0], l2[1])
        if intersect:
            dist = math.hypot(intersect[0] - orig_v[0], intersect[1] - orig_v[1])
            miter_limit = 3.0
            if dist > max(edge_offsets[i-1], edge_offsets[i]) * miter_limit:
                # Spike detected! Bevel it.
                new_vertices.append(l1[1])
                new_vertices.append(l2[0])
            else:
                new_vertices.append(intersect)
        else:
            # Parallel lines, bridge the gap
            new_vertices.append(l1[1])
            new_vertices.append(l2[0])
            
    miter_poly = Polygon(new_vertices)
    if not miter_poly.is_valid:
        miter_poly = miter_poly.buffer(0)
        
    # Apply a smoothing fillet to outer corners
    # A standard safety zone is filleted with a small radius for a natural CAD-like look
    smoothed_poly = miter_poly.buffer(-500).buffer(500, join_style=1)
    
    smoothed_poly = smoothed_poly.simplify(10)
    
    if smoothed_poly.geom_type == 'MultiPolygon':
        smoothed_poly = max(smoothed_poly.geoms, key=lambda a: a.area)
         
    return smoothed_poly

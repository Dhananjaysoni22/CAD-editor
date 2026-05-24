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
    coords = list(base_polygon.exterior.coords)
    # The last coordinate is same as the first in a closed polygon
    if coords[0] == coords[-1]:
        coords = coords[:-1]
        
    n = len(coords)
    if len(edge_offsets) != n:
        # Fallback if mismatch
        edge_offsets = [1500] * n
        
    # Create offset lines for each segment
    offset_lines = []
    for i in range(n):
        p1 = np.array(coords[i])
        p2 = np.array(coords[(i + 1) % n])
        
        # Calculate normal vector (pointing outwards)
        # Assumes polygon is CCW. If CW, normal direction flips.
        # Let's ensure base_polygon is CCW
        
        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]
        length = math.hypot(dx, dy)
        if length == 0:
            nx, ny = 0, 0
        else:
            nx = -dy / length
            ny = dx / length
            
        offset_dist = edge_offsets[i]
        
        # New points
        new_p1 = p1 + np.array([nx, ny]) * offset_dist
        new_p2 = p2 + np.array([nx, ny]) * offset_dist
        
        offset_lines.append((new_p1, new_p2))
        
    # Now intersect adjacent offset lines to find new vertices
    new_vertices = []
    
    # We will also create a buffered version of the base polygon to ensure smooth corners
    # The true variable offset is the union of offset lines and corner arcs, but for simplicity
    # we can construct it by unioning the buffered edges!
    
    buffered_edges = []
    for i in range(n):
        p1 = coords[i]
        p2 = coords[(i + 1) % n]
        line = LineString([p1, p2])
        # Buffer this segment with a round join style for smooth corners
        # Single sided buffer is better but Shapely's single_sided buffer is sometimes tricky.
        # Standard buffer creates a capsule.
        capsule = line.buffer(edge_offsets[i], join_style=1, cap_style=1)
        buffered_edges.append(capsule)
        
    # The union of all these capsules plus the original polygon forms the safe zone!
    # This automatically handles smooth corner transitions (fillets) because of the round caps.
    # And it correctly handles variable offsets.
    
    union_poly = unary_union([base_polygon] + buffered_edges)
    
    # Simplify slightly to clean up collinear points and tiny segments
    union_poly = union_poly.simplify(10)
    
    # Ensure it's a single polygon
    if isinstance(union_poly, MultiPolygon):
         union_poly = max(union_poly.geoms, key=lambda a: a.area)
         
    # To return it as a list of points (and later edges), we just get the exterior coords
    return union_poly

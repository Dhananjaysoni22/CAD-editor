from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Tuple
import tempfile
import os
import shutil
from geometry import load_footprint_from_glb, apply_variable_offset
from shapely.geometry import Polygon

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class OffsetRequest(BaseModel):
    footprint: List[Tuple[float, float]]
    offsets: List[float]

class PointsRequest(BaseModel):
    points: List[Tuple[float, float]]

@app.post("/generate-safezone")
async def generate_safezone(req: PointsRequest):
    try:
        import shapely
        from shapely.geometry import MultiPoint
        
        if not req.points:
            return {"error": "No points received."}
            
        mp = MultiPoint(req.points)
        footprint_poly = shapely.concave_hull(mp, ratio=0.1)
        
        if footprint_poly.is_empty or footprint_poly.geom_type not in ['Polygon', 'MultiPolygon']:
             footprint_poly = mp.convex_hull
             
        footprint_poly = footprint_poly.buffer(300, join_style=2).buffer(-300, join_style=2).buffer(50).simplify(250)
        
        if footprint_poly.geom_type == 'MultiPolygon':
            footprint_poly = max(footprint_poly.geoms, key=lambda a: a.area)
            
        coords = list(footprint_poly.exterior.coords)
        if len(coords) > 0 and coords[0] == coords[-1]:
             coords = coords[:-1]
             
        n_edges = len(coords)
        default_offsets = [1500.0] * n_edges
        
        safe_zone_poly = apply_variable_offset(footprint_poly, default_offsets)
        
        safe_zone_coords = list(safe_zone_poly.exterior.coords)
        if len(safe_zone_coords) > 0 and safe_zone_coords[0] == safe_zone_coords[-1]:
             safe_zone_coords = safe_zone_coords[:-1]
             
        return {
            "footprint": coords,
            "offsets": default_offsets,
            "safeZone": safe_zone_coords
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}

@app.post("/upload")
async def upload_model(file: UploadFile = File(...)):
    # Legacy endpoint, we can just return success as geometry is now processed in frontend
    return {"status": "ok"}

@app.post("/recalculate-offset")
async def recalculate_offset(req: OffsetRequest):
    try:
        footprint_poly = Polygon(req.footprint)
        safe_zone_poly = apply_variable_offset(footprint_poly, req.offsets)
        
        safe_zone_coords = list(safe_zone_poly.exterior.coords)
        if safe_zone_coords[0] == safe_zone_coords[-1]:
             safe_zone_coords = safe_zone_coords[:-1]
             
        return {
            "safeZone": safe_zone_coords
        }
    except Exception as e:
         return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

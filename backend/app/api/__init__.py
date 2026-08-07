from fastapi import APIRouter

from app.api.endpoints import data, calibration, reports, irms

api_router = APIRouter()

api_router.include_router(data.router, prefix="/data", tags=["data"])
api_router.include_router(calibration.router, prefix="/calibration", tags=["calibration"])
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
api_router.include_router(irms.router, prefix="/irms", tags=["irms"])

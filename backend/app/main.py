from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import api_router
from app.core.config import settings

app = FastAPI(
    title="IRMS Output Analyzer API",
    description="Isotope Ratio Mass Spectrometer Output Analyzer Backend",
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/")
async def root():
    return JSONResponse(
        content={
            "message": "IRMS Output Analyzer API",
            "version": "1.0.0",
            "docs_url": "/docs",
        }
    )


@app.get("/health")
async def health_check():
    return JSONResponse(content={"status": "healthy"})
from fastapi import APIRouter, HTTPException, UploadFile, File
from typing import List

router = APIRouter()


@router.post("/upload")
async def upload_data_file(file: UploadFile = File(...)):
    """Upload IRMS data file for processing"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Basic file validation
    allowed_extensions = ['.txt', '.csv', '.xlsx', '.dat']
    file_extension = '.' + file.filename.split('.')[-1].lower()

    if file_extension not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed types: {allowed_extensions}"
        )

    return {
        "message": "File uploaded successfully",
        "filename": file.filename,
        "content_type": file.content_type,
        "size": file.size
    }


@router.get("/files")
async def list_data_files():
    """List all uploaded data files"""
    # Placeholder - in production would list actual files
    return {
        "files": [
            {
                "id": 1,
                "filename": "sample_data_001.txt",
                "upload_date": "2024-01-15T10:30:00Z",
                "size": 15420,
                "status": "processed"
            },
            {
                "id": 2,
                "filename": "calibration_run_002.csv",
                "upload_date": "2024-01-15T11:15:00Z",
                "size": 8920,
                "status": "processing"
            }
        ]
    }


@router.get("/files/{file_id}")
async def get_data_file(file_id: int):
    """Get details of a specific data file"""
    # Placeholder - in production would fetch actual file data
    return {
        "id": file_id,
        "filename": f"data_{file_id}.txt",
        "upload_date": "2024-01-15T10:30:00Z",
        "size": 15420,
        "status": "processed",
        "metadata": {
            "sample_count": 150,
            "measurement_type": "delta13C",
            "instrument": "IRMS-2000"
        }
    }


@router.delete("/files/{file_id}")
async def delete_data_file(file_id: int):
    """Delete a data file"""
    return {"message": f"File {file_id} deleted successfully"}
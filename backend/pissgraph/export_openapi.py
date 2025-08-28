"""Export OpenAPI JSON schema without running the server."""

import json
import sys
from pathlib import Path

from .api import create_app
from .database import Database


def export_openapi_json(output_path: str) -> None:
    """Export OpenAPI JSON to file without starting the server."""
    # Create a dummy database instance (won't be used)
    database = Database(":memory:")
    
    # Create the FastAPI app
    app = create_app(database)
    
    # Generate OpenAPI JSON
    openapi_json = app.openapi()
    
    # Ensure output directory exists
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    # Write to file
    with open(output_file, 'w') as f:
        json.dump(openapi_json, f, indent=2, default=str)
    
    print(f"OpenAPI JSON exported to {output_path}")


if __name__ == "__main__":
    output_path = sys.argv[1] if len(sys.argv) > 1 else "openapi.json"
    export_openapi_json(output_path)
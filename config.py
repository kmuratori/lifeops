"""LifeOps config — port, DB path, LAN access toggle."""
import os

PORT = int(os.environ.get("PORT", os.environ.get("LIFEOPS_PORT", 7070)))
HOST = os.environ.get("HOST", "0.0.0.0" if os.environ.get("LIFEOPS_LAN", "false").lower() == "true" else "127.0.0.1")

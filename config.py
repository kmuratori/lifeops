"""LifeOps config — port, DB path, LAN access toggle."""
import os

PORT = int(os.environ.get("LIFEOPS_PORT", 7070))
LAN_ACCESS = os.environ.get("LIFEOPS_LAN", "false").lower() == "true"
HOST = "0.0.0.0" if LAN_ACCESS else "127.0.0.1"

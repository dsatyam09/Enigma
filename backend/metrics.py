from collections import defaultdict

# In-memory store: endpoint path → list of execution times in milliseconds.
# Populated by the HTTP middleware in main.py; read by GET /performance.
endpoint_times: dict[str, list[float]] = defaultdict(list)

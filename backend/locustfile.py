# locustfile.py
from locust import HttpUser, task, between
from random import randint, choice

PLAYERS = [f"player_{i}" for i in range(1, 51)]

class LeaderboardUser(HttpUser):
    wait_time = between(0.1, 0.3)

    @task(8)
    def get_leaderboard(self):
        self.client.get("/leaderboard")

    @task(2)
    def get_info(self):
        self.client.get("/info")

    @task(2)
    def add_score(self):
        self.client.post("/add", json={
            "player_name": choice(PLAYERS),
            "rating": randint(0, 5000)
        })

    @task(1)
    def get_history(self):
        self.client.get(f"/history?player_name={choice(PLAYERS)}")
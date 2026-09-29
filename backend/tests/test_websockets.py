import pytest
from fastapi.testclient import TestClient
from server import app

client = TestClient(app)

def test_websocket_broadcast():
    ride_id = "test-ride-123"
    
    with client.websocket_connect(f"/api/rides/shared/{ride_id}/ws/driver1") as ws_driver:
        with client.websocket_connect(f"/api/rides/shared/{ride_id}/ws/pax1") as ws_pax1:
            with client.websocket_connect(f"/api/rides/shared/{ride_id}/ws/pax2") as ws_pax2:
                
                # Driver sends location
                ws_driver.send_json({"type": "location", "lat": 12.0, "lng": 80.0})
                
                # Both passengers should receive it
                data1 = ws_pax1.receive_json()
                assert data1["type"] == "location"
                assert data1["lat"] == 12.0
                assert data1["sender_id"] == "driver1"
                
                data2 = ws_pax2.receive_json()
                assert data2["type"] == "location"
                
                # Driver sends deviation
                ws_driver.send_json({"type": "deviation"})
                
                alert1 = ws_pax1.receive_json()
                assert alert1["type"] == "alert"
                assert alert1["message"] == "Route deviation detected!"

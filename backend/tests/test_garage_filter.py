"""Only garages that repair cars are offered to the car agent."""

def test_motorbike_and_bicycle_shops_are_not_garages_for_a_car() -> None:
    from agent.tools.garage_search import for_cars

    for name in ("Motobike Repair and Shop", "Bike repair", "Sửa xe máy Tuấn", "Honda Head Phát Tiến", "Motorcycle service"):
        assert not for_cars(name), name
    for name in ("THANHBINHAUTO", "Garage Kiên Bảo", "Toyota Tân Cảng", "Xí nghiệp dịch vụ ô tô An Phú", "Honda Ô tô Đà Nẵng"):
        assert for_cars(name), name

import pytest
from skiplist import SkipList


def make_sl(*entries: tuple[str, float]) -> SkipList:
    sl = SkipList()
    for player, score in entries:
        sl.insert(player, score)
    return sl


def test_empty_length():
    assert SkipList().length == 0


def test_length_after_inserts():
    sl = make_sl(("alice", 100), ("bob", 200), ("carol", 150))
    assert sl.length == 3


def test_top_k_descending_order():
    sl = make_sl(("alice", 100), ("bob", 300), ("carol", 200))
    assert sl.top_k(3) == [("bob", 300.0), ("carol", 200.0), ("alice", 100.0)]


def test_top_k_partial():
    sl = make_sl(("a", 10), ("b", 20), ("c", 30), ("d", 40))
    assert sl.top_k(2) == [("d", 40.0), ("c", 30.0)]


def test_top_k_empty_list():
    assert SkipList().top_k(5) == []


def test_top_k_k_exceeds_length():
    sl = make_sl(("a", 1), ("b", 2))
    assert sl.top_k(10) == [("b", 2.0), ("a", 1.0)]


def test_top_k_single():
    sl = make_sl(("only", 42))
    assert sl.top_k(1) == [("only", 42.0)]


def test_delete_existing():
    sl = make_sl(("alice", 100), ("bob", 200))
    assert sl.delete("alice", 100.0) is True
    assert sl.length == 1
    assert sl.top_k(2) == [("bob", 200.0)]


def test_delete_nonexistent_player():
    sl = make_sl(("alice", 100))
    assert sl.delete("ghost", 999.0) is False
    assert sl.length == 1


def test_delete_wrong_score():
    sl = make_sl(("alice", 100))
    assert sl.delete("alice", 999.0) is False
    assert sl.length == 1


def test_delete_then_reinsert():
    sl = make_sl(("alice", 100))
    sl.delete("alice", 100.0)
    sl.insert("alice", 200.0)
    assert sl.length == 1
    assert sl.top_k(1) == [("alice", 200.0)]


def test_rank_basic():
    sl = make_sl(("alice", 100), ("bob", 300), ("carol", 200))
    assert sl.get_rank("bob", 300.0) == 1
    assert sl.get_rank("carol", 200.0) == 2
    assert sl.get_rank("alice", 100.0) == 3


def test_rank_single_entry():
    sl = make_sl(("solo", 500))
    assert sl.get_rank("solo", 500.0) == 1


def test_rank_after_delete():
    sl = make_sl(("alice", 100), ("bob", 300), ("carol", 200))
    sl.delete("bob", 300.0)
    assert sl.get_rank("carol", 200.0) == 1
    assert sl.get_rank("alice", 100.0) == 2


def test_rank_not_found():
    sl = make_sl(("alice", 100))
    assert sl.get_rank("ghost", 999.0) == -1


def test_tie_breaking_top_k():
    sl = make_sl(("zebra", 100), ("apple", 100), ("mango", 100))
    result = sl.top_k(3)
    # Ascending: apple, mango, zebra — reversed: zebra, mango, apple
    assert result[0] == ("zebra", 100.0)
    assert result[1] == ("mango", 100.0)
    assert result[2] == ("apple", 100.0)


def test_tie_breaking_rank():
    sl = make_sl(("zebra", 100), ("apple", 100), ("mango", 100))
    # In ascending order: apple(1st), mango(2nd), zebra(3rd)
    # Rank from top: zebra=1, mango=2, apple=3
    assert sl.get_rank("zebra", 100.0) == 1
    assert sl.get_rank("mango", 100.0) == 2
    assert sl.get_rank("apple", 100.0) == 3


def test_rank_consistency():
    entries = [("a", 50), ("b", 80), ("c", 30), ("d", 70), ("e", 60)]
    sl = make_sl(*entries)
    assert sl.get_rank("b", 80.0) == 1
    assert sl.get_rank("d", 70.0) == 2
    assert sl.get_rank("e", 60.0) == 3
    assert sl.get_rank("a", 50.0) == 4
    assert sl.get_rank("c", 30.0) == 5


def test_insert_100_entries():
    sl = SkipList()
    for i in range(100):
        sl.insert(f"player{i:03d}", float(i))
    assert sl.length == 100
    top = sl.top_k(5)
    assert top[0] == ("player099", 99.0)
    assert top[4] == ("player095", 95.0)


def test_rank_100_entries():
    sl = SkipList()
    for i in range(100):
        sl.insert(f"p{i:03d}", float(i))
    assert sl.get_rank("p099", 99.0) == 1
    assert sl.get_rank("p000", 0.0) == 100


def test_delete_all_entries():
    sl = make_sl(("a", 1), ("b", 2), ("c", 3))
    sl.delete("a", 1.0)
    sl.delete("b", 2.0)
    sl.delete("c", 3.0)
    assert sl.length == 0
    assert sl.top_k(5) == []

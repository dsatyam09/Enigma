import math
import pytest
from stats import RunningStats, quickselect, percentile


# ── RunningStats (Welford's algorithm) ────────────────────────────────────────

def test_single_update():
    rs = RunningStats()
    rs.update(42)
    assert rs.count == 1
    assert rs.mean == 42.0
    assert rs.variance == 0.0
    assert rs.std_dev == 0.0


def test_mean_known_dataset():
    # [2, 4, 4, 4, 5, 5, 7, 9] — mean = 5.0
    rs = RunningStats()
    for v in [2, 4, 4, 4, 5, 5, 7, 9]:
        rs.update(v)
    assert abs(rs.mean - 5.0) < 1e-9


def test_population_variance_known_dataset():
    # Population variance of [2, 4, 4, 4, 5, 5, 7, 9] = 4.0
    rs = RunningStats()
    for v in [2, 4, 4, 4, 5, 5, 7, 9]:
        rs.update(v)
    assert abs(rs.variance - 4.0) < 1e-9


def test_std_dev_known_dataset():
    # std_dev = sqrt(4.0) = 2.0
    rs = RunningStats()
    for v in [2, 4, 4, 4, 5, 5, 7, 9]:
        rs.update(v)
    assert abs(rs.std_dev - 2.0) < 1e-9


def test_zero_variance_constant_input():
    rs = RunningStats()
    for _ in range(10):
        rs.update(7)
    assert rs.variance == 0.0
    assert rs.std_dev == 0.0
    assert rs.mean == 7.0


def test_min_max():
    rs = RunningStats()
    for v in [3, 1, 4, 1, 5, 9, 2, 6]:
        rs.update(v)
    assert rs.min == 1.0
    assert rs.max == 9.0


def test_min_max_single():
    rs = RunningStats()
    rs.update(42)
    assert rs.min == 42.0
    assert rs.max == 42.0


def test_count():
    rs = RunningStats()
    for i in range(5):
        rs.update(i)
    assert rs.count == 5


def test_snapshot_keys():
    rs = RunningStats()
    rs.update(10)
    snap = rs.snapshot()
    assert set(snap.keys()) == {"count", "mean", "std_dev", "min", "max"}


def test_snapshot_values():
    rs = RunningStats()
    for v in [2, 4, 4, 4, 5, 5, 7, 9]:
        rs.update(v)
    snap = rs.snapshot()
    assert abs(snap["mean"] - 5.0) < 1e-3
    assert abs(snap["std_dev"] - 2.0) < 1e-3


def test_welford_numerical_stability():
    # Large offset — naive sum of squares would lose precision
    rs = RunningStats()
    base = 1_000_000
    for v in [base + 1, base + 2, base + 3, base + 4, base + 5]:
        rs.update(v)
    assert abs(rs.mean - (base + 3)) < 1e-6
    assert abs(rs.variance - 2.0) < 1e-6


# ── quickselect ───────────────────────────────────────────────────────────────

def test_quickselect_min():
    arr = [3, 1, 4, 1, 5, 9, 2, 6]
    assert quickselect(arr, 0) == 1.0


def test_quickselect_max():
    arr = [3, 1, 4, 1, 5, 9, 2, 6]
    assert quickselect(arr, len(arr) - 1) == 9.0


def test_quickselect_median_position():
    arr = [3, 1, 4, 1, 5, 9, 2, 6]
    # sorted: [1,1,2,3,4,5,6,9] → index 4 = 4
    assert quickselect(arr, 4) == 4.0


def test_quickselect_single():
    assert quickselect([42], 0) == 42.0


def test_quickselect_two_elements():
    assert quickselect([5, 3], 0) == 3.0
    assert quickselect([5, 3], 1) == 5.0


def test_quickselect_does_not_mutate():
    arr = [5, 3, 1, 4, 2]
    original = list(arr)
    quickselect(arr, 2)
    assert arr == original


def test_quickselect_already_sorted():
    arr = list(range(10))
    for k in range(10):
        assert quickselect(arr, k) == float(k)


def test_quickselect_reverse_sorted():
    arr = list(range(9, -1, -1))
    for k in range(10):
        assert quickselect(arr, k) == float(k)


# ── percentile ────────────────────────────────────────────────────────────────

def test_percentile_median_odd():
    assert percentile([1, 2, 3, 4, 5], 50) == 3.0


def test_percentile_median_even():
    # [1,2,3,4] → idx = 0.5*3 = 1.5 → 2 + 0.5*(3-2) = 2.5
    assert abs(percentile([1, 2, 3, 4], 50) - 2.5) < 1e-9


def test_percentile_q1():
    # [1..8] → idx = 0.25*7 = 1.75 → 2 + 0.75*(3-2) = 2.75
    assert abs(percentile(list(range(1, 9)), 25) - 2.75) < 1e-9


def test_percentile_q3():
    # [1..8] → idx = 0.75*7 = 5.25 → 6 + 0.25*(7-6) = 6.25
    assert abs(percentile(list(range(1, 9)), 75) - 6.25) < 1e-9


def test_percentile_p0():
    assert percentile([3, 1, 4, 1, 5], 0) == 1.0


def test_percentile_p100():
    assert percentile([3, 1, 4, 1, 5], 100) == 5.0


def test_percentile_single_element():
    assert percentile([99], 50) == 99.0


def test_percentile_empty():
    assert percentile([], 50) == 0.0


def test_percentile_unsorted_input():
    # percentile should work regardless of input order
    ordered = percentile([1, 2, 3, 4, 5], 50)
    unordered = percentile([3, 5, 1, 4, 2], 50)
    assert abs(ordered - unordered) < 1e-9

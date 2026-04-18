from typing import Union

Number = Union[int, float]


class RunningStats:
    """
    Welford's online algorithm — O(1) per update, no stored data list.
    Uses population variance (divide by N).
    """

    def __init__(self) -> None:
        self._n = 0
        self._mean = 0.0
        self._M2 = 0.0
        self._min: float = float("inf")
        self._max: float = float("-inf")

    def update(self, value: Number) -> None:
        self._n += 1
        delta = value - self._mean
        self._mean += delta / self._n
        delta2 = value - self._mean
        self._M2 += delta * delta2
        if value < self._min:
            self._min = float(value)
        if value > self._max:
            self._max = float(value)

    @property
    def count(self) -> int:
        return self._n

    @property
    def mean(self) -> float:
        return self._mean

    @property
    def variance(self) -> float:
        return self._M2 / self._n if self._n > 0 else 0.0

    @property
    def std_dev(self) -> float:
        return self.variance ** 0.5

    @property
    def min(self) -> float:
        return self._min if self._n > 0 else 0.0

    @property
    def max(self) -> float:
        return self._max if self._n > 0 else 0.0

    def snapshot(self) -> dict:
        return {
            "count": self._n,
            "mean": round(self._mean, 4),
            "std_dev": round(self.std_dev, 4),
            "min": self.min,
            "max": self.max,
        }


def quickselect(arr: list, k: int) -> float:
    """
    kth smallest element (0-indexed k) in O(N) average via Lomuto partition.
    Does not mutate the input list.
    """
    a = list(arr)
    left, right = 0, len(a) - 1
    while left < right:
        pivot = a[right]
        i = left
        for j in range(left, right):
            if a[j] <= pivot:
                a[i], a[j] = a[j], a[i]
                i += 1
        a[i], a[right] = a[right], a[i]
        if i == k:
            return float(a[i])
        elif i < k:
            left = i + 1
        else:
            right = i - 1
    return float(a[left])


def percentile(scores: list, p: float) -> float:
    """
    Value at the pth percentile (0–100) via linear interpolation using quickselect.
    Matches numpy's default (linear) method.
    """
    n = len(scores)
    if n == 0:
        return 0.0
    if n == 1:
        return float(scores[0])
    idx = (p / 100) * (n - 1)
    lo, hi = int(idx), min(int(idx) + 1, n - 1)
    lo_val = quickselect(scores, lo)
    hi_val = quickselect(scores, hi)
    return lo_val + (idx - lo) * (hi_val - lo_val)

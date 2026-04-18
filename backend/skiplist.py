import random

MAX_LEVEL = 16
P = 0.5


class _Node:
    __slots__ = ("player", "score", "forward", "span")

    def __init__(self, player: str, score: float, level: int) -> None:
        self.player = player
        self.score = score
        self.forward: list["_Node | None"] = [None] * level
        self.span: list[int] = [0] * level


class SkipList:
    """
    Sorted skip list keyed on (score ASC, player ASC).
    Span tracking on every level pointer enables O(log N) rank queries.
    """

    def __init__(self) -> None:
        self._head = _Node("", float("-inf"), MAX_LEVEL)
        self._level = 1
        self._length = 0

    @property
    def length(self) -> int:
        return self._length

    @staticmethod
    def _random_level() -> int:
        level = 1
        while random.random() < P and level < MAX_LEVEL:
            level += 1
        return level

    @staticmethod
    def _before(s1: float, p1: str, s2: float, p2: str) -> bool:
        """True if (s1, p1) strictly precedes (s2, p2) in ascending key order."""
        return s1 < s2 or (s1 == s2 and p1 < p2)

    def insert(self, player: str, score: float) -> None:
        update: list[_Node] = [None] * MAX_LEVEL  # type: ignore[list-item]
        rank: list[int] = [0] * MAX_LEVEL

        x = self._head
        for i in range(self._level - 1, -1, -1):
            rank[i] = rank[i + 1] if i < self._level - 1 else 0
            while x.forward[i] is not None and self._before(
                x.forward[i].score, x.forward[i].player, score, player
            ):
                rank[i] += x.span[i]
                x = x.forward[i]
            update[i] = x

        level = self._random_level()
        if level > self._level:
            for i in range(self._level, level):
                rank[i] = 0
                update[i] = self._head
                update[i].span[i] = self._length
            self._level = level

        node = _Node(player, score, level)
        for i in range(level):
            node.forward[i] = update[i].forward[i]
            update[i].forward[i] = node
            node.span[i] = update[i].span[i] - (rank[0] - rank[i])
            update[i].span[i] = (rank[0] - rank[i]) + 1

        for i in range(level, self._level):
            update[i].span[i] += 1

        self._length += 1

    def delete(self, player: str, score: float) -> bool:
        update: list[_Node] = [None] * MAX_LEVEL  # type: ignore[list-item]
        x = self._head
        for i in range(self._level - 1, -1, -1):
            while x.forward[i] is not None and self._before(
                x.forward[i].score, x.forward[i].player, score, player
            ):
                x = x.forward[i]
            update[i] = x

        target = x.forward[0]
        if target is None or target.score != score or target.player != player:
            return False

        for i in range(self._level):
            if update[i].forward[i] is target:
                update[i].span[i] += target.span[i] - 1
                update[i].forward[i] = target.forward[i]
            else:
                update[i].span[i] -= 1

        while self._level > 1 and self._head.forward[self._level - 1] is None:
            self._level -= 1

        self._length -= 1
        return True

    def get_rank(self, player: str, score: float) -> int:
        """1-based rank from the top (rank 1 = highest score). Returns -1 if not found."""
        rank = 0
        x = self._head
        for i in range(self._level - 1, -1, -1):
            while x.forward[i] is not None and self._before(
                x.forward[i].score, x.forward[i].player, score, player
            ):
                rank += x.span[i]
                x = x.forward[i]

        candidate = x.forward[0]
        if candidate is None or candidate.score != score or candidate.player != player:
            return -1

        rank += 1  # 1-based position from left (ascending)
        return self._length - rank + 1

    def top_k(self, k: int) -> list[tuple[str, float]]:
        """Top K entries in descending score order. O(K + log N)."""
        k = min(k, self._length)
        if k == 0:
            return []

        # O(log N): jump to the node at 0-indexed position (length - k) from the header
        target = self._length - k
        x = self._head
        traversed = 0
        for i in range(self._level - 1, -1, -1):
            while x.forward[i] is not None and traversed + x.span[i] <= target:
                traversed += x.span[i]
                x = x.forward[i]

        # O(K): walk forward and collect
        result: list[tuple[str, float]] = []
        node = x.forward[0]
        while node is not None and len(result) < k:
            result.append((node.player, node.score))
            node = node.forward[0]

        result.reverse()
        return result

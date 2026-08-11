from core.cache import UserScopedCache

from .constants import CACHE_PREFIX

entries_cache = UserScopedCache(CACHE_PREFIX)

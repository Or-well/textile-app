# Project Rules

- Current project does not use vue-router; `App.vue` owns pathname parsing and `history.pushState` navigation.
- Do not implement project Git sync.
- Collaboration uses change packages, signed change packages, and owner import/merge.
- Vue pages must not read or write project files directly.
- Put business logic in services.
- Use `can(user, action)` or permission wrapper functions for permission checks.
- Normal UI must not show Git terms.
- Before write, import, or delete flows, consider data consistency.
- Do not add large UI frameworks.

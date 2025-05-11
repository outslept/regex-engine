# Regex Engine in JavaScript

A simple regex engine that parses regex strings, builds a Non-deterministic Finite Automaton (NFA) using Thompson's construction principles, and simulates the NFA to match input strings.

## Supported Features:

* **Literals:** `a`, `abc`
* **Character Classes:** `[abc]`, `[a-z0-9]` (hyphen as literal: `[-a]`, `[a-]`)
* **Alternation:** `a|b`
* **Grouping:** `(abc)` (for precedence and quantification, non-capturing)
* **Quantifiers:**
  * `*` (zero or more)
  * `+` (one or more)
  * `?` (zero or one)
  * `{m}` (exactly m)
  * `{m,}` (m or more)
  * `{m,n}` (between m and n)

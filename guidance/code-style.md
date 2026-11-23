# Code Style Guidelines

My code style for every project. The [Copy into CLAUDE.md](#copy-into-claudemd) section at the bottom is ready to paste into a new project's `CLAUDE.md`.

> **Golden Rule:** The best code is the simplest code that correctly solves the problem, explains itself without comments, and remains easy to maintain.

Write clean, natural, human-readable code that looks like it was written by an experienced senior developer.

Many rules limit each other (DRY, but no abstractions for trivial repetition; small methods, but no splitting simple logic), so none of them is applied dogmatically.

## Language

- I chat with Claude in Polish (sometimes English). Code, commit messages and repo docs are always in **English**.

## Principles

**Simplicity**
- **KISS:** Prefer straightforward solutions over unnecessary complexity.
- **YAGNI:** Implement only what is currently required. Never build for hypothetical future needs.
- **DRY:** Avoid duplicated business logic, but don't introduce abstractions for trivial repetition.
- **No AI Fingerprints:** Avoid boilerplate, redundant wrappers, unnecessary patterns, artificial complexity, and generated-looking structures.

**Structure**
- **SOLID, pragmatically:** Avoid excessive interfaces, inheritance, and abstraction layers.
- **Separation of Concerns / Single Responsibility:** Each class and method has one clear purpose, without overengineering.
- **Composition Over Inheritance:** Prefer composition when it genuinely reduces coupling and complexity.
- **Small, Focused Methods:** Short methods with clear intent, but don't split simple logic into unnecessary helpers.
- **Testability:** Code is naturally testable, without abstractions made only for mocking.

**Readability**
- **Clean Code:** Readability, maintainability and predictable behavior over clever implementations.
- **Meaningful Naming:** Concise, descriptive, domain-specific names. No unnecessary abbreviations, no overly verbose identifiers.
- **No Comments:** No inline comments, block comments, XML docs or explanatory annotations. Code documents itself. When a "why" matters, put it in names and tests.
- **Early Returns:** Guard clauses instead of nesting.
- **Explicit Over Clever:** No magic values, hidden side effects, unnecessary metaprogramming or overly complex expressions.

**Working in a project**
- **Consistency:** Follow the project's existing conventions, naming, formatting, patterns and architecture.
- **Modern Practices:** Idiomatic language features, but never at the cost of clarity.
- **Error Handling:** Handle realistic failures explicitly. Never swallow exceptions, don't pile up defensive checks.
- **Minimal Changes:** Change only what the task needs. No unrelated refactors, speculative improvements or new dependencies.
- **Performance:** Avoid obvious inefficiencies, but never trade readability for unmeasured micro-optimizations.

## Formatting and syntax

These are my own additions; they set my style apart the most.

- **Always braces**, even for a single-statement `if`.
- **Allman style in every language**, C# and TypeScript: the opening brace goes on its own line.
- Never put a block on one line (`{ stack.Pop(); continue; }` gets spread out). One statement per line.
- **Block bodies, not `=>`.** Methods and members use `{ return ...; }`, even one-liners. Short lambdas (e.g. `x => x.Id` in LINQ) may stay expressions.
- **Blank lines:** before every `if` / `for` / `foreach` / `while`, after every closing `}`, and before `return`.
- **One declaration per line.** Never `int h = ..., w = ...;` or `let a = ..., b = ...;`.
- **No tuples, in any language.** Use a small named `record` in C# and an object with named fields in TypeScript (`{ key, label }`, `{ x, y }`, `it.each` tables with objects).
- **No nested ternaries.** Use early returns.
- Split `return finish(...)` with a side effect into the call and a separate `return`. No `else` after a `throw`; use a guard.

Preferred method shape (call, blank line, guard on failure, blank line, happy path):

```csharp
public ActionResult<RandomMazeResponse> Random(int? size)
{
    var result = service.GenerateRandomMaze(size);

    if (result.IsFailure)
    {
        return this.Invalid(result.Error);
    }

    return Ok(result.Value);
}
```

## Naming

- Full descriptive names, no abbreviations: `random` not `rnd`, `Width` / `Height` not `W` / `H`, `element` not `el`, `activeIndex` not `activeIdx`.
- Lambda parameters too: `row`, `cell`, `value`, not `r`, `c`, `v`.
- **API / JSON contracts use full words too.** Rename the field (`Op { T, I, J, V }` became `SortStep { Type, Index, OtherIndex, Value }`) instead of hiding short names behind `[JsonPropertyName]`.
- Loop counters `i` / `j` are fine in algorithmic code.
- Named constants or configuration instead of magic numbers: `MaxRequestBodyBytes = 4096`, `OPERATION_BUDGET` not `BUDGET`.

## Async and errors

- **Async only for real I/O.** CPU-bound work never fakes async with `Task.FromResult`. The signature tells the truth.
- **Expected failures are values.** Validation returns a result type with `IsFailure` / `Value` / `Error`, not a `(value, error)` tuple and not an exception caught by a filter. Exceptions are for exceptional situations.

## Changing existing code

- Minimal changes: only what the task is about.
- **Rename with language tooling, not find-and-replace.** The compiler doesn't check strings, CSS selectors or attribute values (a `btn` → `button` replace once broke an `.inspect-btn` e2e selector). After a rename, check those by hand and confirm with tests.

## Keep the project small

- Plain app first. No schedulers, backup scripts, publish/install scripts, extra test databases or other ops tooling unless I ask for it. Offer it as an option, never build it unasked.
- One place for the logic. If the backend owns an algorithm, the frontend only shows and validates the result. No mirrored copy of the logic in another language, no silent browser fallback.
- Risky logic ships with a test (Ponytail enforces this, see the main README).

## Project rules from Honest Work

These fit my style, but they depend on the kind of project, so they are not automatically rules everywhere. Add them to a project's `CLAUDE.md` only where they fit.

- **Thin controller with `Result<T>`.** The controller calls the service and maps `Result<T>` to `Ok` or `ValidationProblem`; the client gets errors as `ProblemDetails`.
- **Validation limits in configuration.** `MaxItems`, `DefaultSize`, `DefaultCount` live in an options object read from `appsettings.json` through `IOptions<T>` (`SortingOptions`, `MazeOptions`), not in constants spread across classes. The controller passes `size` on without `size ?? Service.DefaultSize`.
- **Braces enforced in C# by `.editorconfig`:** `csharp_prefer_braces = true:warning`. Nothing checks this in TypeScript; there the rule lives in `CLAUDE.md`.
- **Modern C#:** primary constructors, collection expressions `[...]`, pattern matching (`is [.., var last]`), raw string literals for SQL.

## Copy into CLAUDE.md

```markdown
# Code Style Guidelines

Write clean, natural, human-readable code that looks like it was written by an experienced senior developer.

## Principles

- KISS: Prefer straightforward solutions over unnecessary complexity.
- DRY: Avoid duplicated business logic, but don't introduce abstractions for trivial repetition.
- YAGNI: Implement only what is currently required. Never build for hypothetical future needs.
- SOLID: Apply principles pragmatically, not dogmatically. Avoid excessive interfaces, inheritance, and abstraction layers.
- Separation of Concerns: Keep responsibilities clearly separated without overengineering.
- Single Responsibility: Each class and method should have one clear purpose.
- Clean Code: Prioritize readability, maintainability, and predictable behavior over clever implementations.
- Meaningful Naming: Use concise, descriptive, domain-specific names. Avoid unnecessary abbreviations and overly verbose identifiers.
- No Comments: Never generate inline comments, block comments, XML documentation, or explanatory annotations. Code must be self-documenting.
- Small, Focused Methods: Prefer short methods with clear intent, but avoid splitting simple logic into unnecessary helpers.
- Early Returns: Reduce nesting and improve readability with guard clauses where appropriate.
- Explicit Over Clever: Avoid magic values, hidden side effects, unnecessary metaprogramming, and overly complex expressions.
- Composition Over Inheritance: Prefer composition when it genuinely reduces coupling and complexity.
- Consistency: Follow existing project conventions, naming, formatting, patterns, and architecture.
- Modern Practices: Use idiomatic language features and established best practices without sacrificing clarity.
- Error Handling: Handle realistic failures explicitly. Never silently swallow exceptions or introduce excessive defensive checks.
- Minimal Changes: Modify only what is necessary. Avoid unrelated refactoring, speculative improvements, and unnecessary dependencies.
- Testability: Design code that is naturally testable without introducing abstractions solely for mocking.
- Performance: Avoid obvious inefficiencies, but never sacrifice readability for unmeasured micro-optimizations.
- No AI Fingerprints: Avoid boilerplate, redundant wrappers, unnecessary patterns, artificial complexity, and generated-looking structures.

## Formatting and syntax

- Always use braces, even for single-statement blocks.
- Allman style in every language (C# and TypeScript): the opening brace goes on its own line.
- Never put a block on one line; one statement per line.
- Methods and members use block bodies `{ return ...; }`, even one-liners. No expression-bodied `=>` members. Short lambdas (e.g. `x => x.Id`) may stay expressions.
- Add a blank line before every `if` / `for` / `foreach` / `while`, after every closing `}`, and before `return`.
- One declaration per line; never `var a = ..., b = ...;`.
- No tuples in any language. Use a small named `record` in C# and an object with named fields in TypeScript.
- No nested ternary operators; use early returns instead.

Preferred method shape:

    public ActionResult<RandomMazeResponse> Random(int? size)
    {
        var result = service.GenerateRandomMaze(size);

        if (result.IsFailure)
        {
            return this.Invalid(result.Error);
        }

        return Ok(result.Value);
    }

## Naming

- Full descriptive names, no abbreviations (`random`, not `rnd`; `element`, not `el`; `activeIndex`, not `activeIdx`), including lambda parameters.
- Names in API/JSON contracts are full words too; never hide short names behind `[JsonPropertyName]`.
- Loop counters `i` / `j` are fine in algorithmic code.
- Replace magic numbers with named constants or configuration.

## Async and errors

- Use async only for real I/O. Never fake async with `Task.FromResult` for CPU-bound work.
- Represent expected failures (validation) as values: a result type with `IsFailure` / `Value` / `Error`, not tuples and not exceptions caught by filters. Exceptions are for exceptional situations.

## Changing code

- Rename with language tooling, not find-and-replace. Then manually check strings, CSS selectors, and attribute values, and confirm with tests.

Golden Rule: The best code is the simplest code that correctly solves the problem, explains itself without comments, and remains easy to maintain.
```

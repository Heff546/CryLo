# Intro

This directory contains tools for checking the health of the CryLo project, including build and run-time analyzers, linters, and related maintenance utilities.

# Usage

Unless stated otherwise, these scripts should be called from a CryLo source directory, for example:

```text
user@host:~/CryLo$ utils/health/clang-build-time-analyzer-run.sh
```

## ClangBuildAnalyzer

`utils/health/clang-build-time-analyzer-run.sh`

ClangBuildAnalyzer helps identify sources of slow compilation.

On first run, the script may report that the ClangBuildAnalyzer binary is missing and direct you to the helper used to clone and build it.

## clang-tidy

```text
utils/health/clang-tidy-run-cc.sh
utils/health/clang-tidy-run-cpp.sh
```

These scripts perform lint checks on the source code and store results in the build directory.

## include-what-you-use

`utils/health/clang-include-what-you-use-run.sh`

This analyzes header-file relationships and provides guidance for reducing unnecessary include complexity.

## Valgrind Checks

`utils/health/valgrind-tests.sh`

This script can run Valgrind callgrind, cachegrind, and memcheck against a provided list of executables and arguments.

It expects one parameter pointing to a text file with one executable command per line, for example:

```text
ls -l -h
build/tests/unit_tests/unit_tests
```

The generated `*.out` files can be viewed with tools such as `kcachegrind`. Memcheck output is written as readable text with a summary.

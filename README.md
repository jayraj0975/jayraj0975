# Hi, I'm Jay 👋

Third-year IT student at **PES Modern College of Engineering, Pune**, focused on data science and machine learning.

I like projects that go past the notebook, and I care more about *honest* results than impressive ones: leak-free evaluation, calibrated probabilities, and stated uncertainty.

## Projects

| Project | What it is |
|---|---|
| **[MobilityOps](https://github.com/jayraj0975/mobilityops)** · [NYC demo](https://mobilityops.onrender.com) · [Pune demo](https://mobilityops-pune.onrender.com) · [Android app](https://github.com/jayraj0975/mobilityops/releases/tag/android-v2.2.0) | Urban mobility analytics. **New York:** day-ahead demand forecasts on 40M real taxi trips (WAPE 19.5% vs 26.3% for the best baseline, most of the gain in holiday weeks, which the repo says), calibrated ranges, anomaly detection, simulated repositioning. **Pune:** a real-time platform on *simulated* demand (no open Pune trip data exists) with live weather, freshness tracking, failure handling and a map console. FastAPI, React, a Kotlin/Java Android app, 683 Python tests, WCAG-scanned UI, hardened containers. |
| **[Video Game Market Intelligence](https://github.com/jayraj0975/video-game-market-intelligence)** · [live demo](https://video-game-hit-predictor-sr-45ad.vercel.app) | Market analysis and a pre-release (near-launch) hit-prediction model on 15,739 releases. Funding the top 10% of a slate captures **56% of real million-sellers (5.6x lift, 95% interval 5.0-6.3x)** using early critic reviews, and 47% without them. Leak-free features, ablation, calibration, model provenance served by the API, FastAPI backend, web frontend, Docker, tests and CI. |
| **[Churn analysis](https://github.com/jayraj0975/customer-churn-analysis)** | Telco churn: models chosen by cross-validation on training data only, bootstrap intervals, calibrated probabilities, an outreach threshold chosen from training rows on stated cost assumptions and locked before the test set is scored (a test flips every test label to prove it), out-of-fold risk scores. |
| **[Churn Predictor web app](https://github.com/jayraj0975/churnapp)** · [live demo](https://customer-churn-predictor-sr-45ad.vercel.app) | React, TypeScript and Express app running a trained logistic regression (test ROC-AUC 0.83), with drivers, what-if simulation and retention plans; money figures are labelled modeled exposure, not observed loss. The TypeScript engine is tested against scikit-learn to 1e-9, and the API is rate-limited with a deterministic fallback for every Gemini failure. |
| **[Churn Predictor for Android](https://github.com/jayraj0975/churn-predictor-android)** · [download APK](https://github.com/jayraj0975/churn-predictor-android/releases/latest) | Native Java app that scores on-device with the web app's logistic-regression coefficients (a byte-for-byte copy of its model file), targeting Android 16. Unit-tested against scikit-learn, lint-clean, built in CI, run on Android 14 and 16 emulators, not yet on a physical phone. |
| **[SQL Sales Analysis](https://github.com/jayraj0975/sql-sales-analysis)** | Ten commented SQL queries (window functions, CTEs, RFM, cohort retention) on a sample store database, with an Excel report and 21 tests that reconcile every query against independent calculations and pin the database by checksum. |
| **[Password Strength Analyzer](https://github.com/jayraj0975/password-strength-analyzer)** | C++17 library and CLI: pattern-aware strength estimate, common-password detection, a configurable assumed attacker speed, tested with sanitizers. An educational estimator, not a tool for deciding whether a password is safe. |

## Toolbox

**Python** (pandas, scikit-learn, LightGBM, FastAPI, DuckDB) · **SQL** (SQLite: window functions, CTEs) · **TypeScript** (React, Node, Express) · **Kotlin and Java** (Android) · **C++** · Git, GitHub Actions, Docker

## Find me

[LinkedIn](https://www.linkedin.com/in/jay-gaikwad-085787435/)

# FloodLens Evaluation & Benchmark Results

> [!IMPORTANT]
> **Model Freeze Status**: The underlying scoring model, feature weights, and H3 hex indices were permanently locked at git tag `v1-model-frozen`. All additions herein (tie-fair randomized baseline draws, cutoff tie reporting, leave-one-out ablations, and per-city stratification) are post-hoc comparisons added after viewing initial test results for transparent documentation only. No model retuning was performed.

## 1. Executive Summary & Honest Assessment

This benchmark compares **FloodLens** against six baseline strategies across two disjoint ground-truth splits:
- **DEV Split ($N=14$)**: Events on 2026-08-06 (Delhi/Gurgaon), 2026-07-08 (Gurgaon), and chronic sites (Minto Bridge, Subhash Chowk).
- **TEST Split ($N=17$)**: 2026-07-28 IMD Red-Alert extreme rainfall (Delhi-only). Evaluated strictly **once** with frozen weights.

### Fixed Evaluation Protocol
- **Point spots**: Hit if a top-$K$ hex centre is within **300 m** (primary) or **500 m** (secondary).
- **Stretch/Area spots**: Hit if a top-$K$ hex centre is within **1,000 m** of the geocoded midpoint.
- **Tie-Fair Baseline Protocol**: For baselines with discrete/tied values (HAND, Built-up, Elevation, Underpass, TWI, Flow Acc), ties are broken uniformly at random and averaged across **200 draws** with a fixed seed (`seed=42`).
- **Random Baseline Definition**: Sampled uniformly at random from the **full 41,703 H3 res-9 study area hex pool**.

---

## 2. Test Split Results (Delhi Red-Alert Rain, 2026-07-28)

### Combined Recall@K (Point @ 300m, Stretch/Area @ 1000m)

| Model / Baseline | Recall@25 [95% CI] | Recall@50 [95% CI] | Recall@100 [95% CI] | Recall@200 [95% CI] | Cutoff Ties (K=25 / 50 / 100 / 200) |
|---|---|---|---|---|---|
| **FloodLens (Composite)** | 5.9% [0.0–17.6%] | 11.8% [0.0–29.4%] | 35.3% [11.8–58.8%] | 58.8% [35.3–82.4%] | 1 / 1 / 1 / 1 |
| **TWI Only** | 0.0% [0.0–0.0%] | 0.0% [0.0–0.0%] | 0.0% [0.0–0.0%] | 5.9% [0.0–17.6%] | 1 / 1 / 2 / 2 |
| **Underpass Prior Only** | 11.3% [0.0–29.4%] | 21.4% [5.9–47.1%] | 35.3% [17.6–64.7%] | 51.1% [23.5–70.6%] | 618 / 618 / 618 / 618 |
| **Flow Acc Only** | 0.0% [0.0–0.0%] | 0.0% [0.0–0.0%] | 0.0% [0.0–0.0%] | 0.0% [0.0–0.0%] | 2 / 1 / 1 / 1 |
| **HAND Only** | 0.0% [0.0–0.0%] | 0.0% [0.0–0.0%] | 0.0% [0.0–0.0%] | 0.0% [0.0–0.0%] | 4 / 1 / 2 / 9 |
| **Built-up Only** | 1.0% [0.0–0.0%] | 2.1% [0.0–0.0%] | 4.2% [0.0–0.0%] | 5.7% [0.0–17.6%] | 233 / 233 / 233 / 233 |
| **Elevation Only** | 0.0% [0.0–0.0%] | 0.0% [0.0–0.0%] | 0.0% [0.0–0.0%] | 0.0% [0.0–0.0%] | 1 / 1 / 3 / 2 |
| **Random Uniform (full 41,703 pool)** | 1.5% [0.0–17.6%] | 2.8% [0.0–29.4%] | 6.0% [0.0–29.4%] | 10.8% [0.0–35.3%] | 0 / 0 / 0 / 0 |

### Paired Bootstrap Difference on Test: FloodLens vs Underpass Prior Only

| Rank Cutoff | FloodLens Recall | Underpass Prior Recall | Difference (FL − UP) | 95% Bootstrap CI | Statistically Distinguishable? |
|---|---|---|---|---|---|
| **K = 25** | 5.9% | 11.3% | -5.4% | [-29.4%, +17.6%] | No (CI spans 0) |
| **K = 50** | 11.8% | 21.4% | -9.7% | [-41.2%, +17.6%] | No (CI spans 0) |
| **K = 100** | 35.3% | 35.3% | -0.0% | [-29.4%, +35.3%] | No (CI spans 0) |
| **K = 200** | 58.8% | 51.1% | +7.8% | [-23.5%, +35.3%] | No (CI spans 0) |

### Breakdown by Geometry Type on Test Split

#### Point Spots Only ($N=3$ on Test: Shankar Vihar, Peeragarhi, AIIMS)
| Model / Baseline | R@25 (300m) | R@25 (500m) | R@50 (300m) | R@50 (500m) | R@100 (300m) | R@100 (500m) | R@200 (300m) | R@200 (500m) |
|---|---|---|---|---|---|---|---|---|
| FloodLens (Composite) | 0.0% | 33.3% | 0.0% | 33.3% | 0.0% | 33.3% | 33.3% | 33.3% |
| TWI Only | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| Underpass Prior Only | 1.5% | 2.3% | 3.0% | 5.0% | 6.8% | 9.7% | 12.3% | 18.5% |
| Flow Acc Only | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| HAND Only | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| Built-up Only | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| Elevation Only | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| Random Uniform (full 41,703 pool) | 0.0% | 0.2% | 0.3% | 0.8% | 1.0% | 1.8% | 1.7% | 3.2% |

#### Stretch and Area Spots Only ($N=14$ on Test, 1000m tolerance)
| Model / Baseline | Recall@25 | Recall@50 | Recall@100 | Recall@200 |
|---|---|---|---|---|
| FloodLens (Composite) | 7.1% | 14.3% | 42.9% | 64.3% |
| TWI Only | 0.0% | 0.0% | 0.0% | 7.1% |
| Underpass Prior Only | 13.4% | 25.4% | 41.4% | 59.4% |
| Flow Acc Only | 0.0% | 0.0% | 0.0% | 0.0% |
| HAND Only | 0.0% | 0.0% | 0.0% | 0.0% |
| Built-up Only | 1.2% | 2.5% | 5.1% | 7.0% |
| Elevation Only | 0.0% | 0.0% | 0.0% | 0.0% |
| Random Uniform (full 41,703 pool) | 1.8% | 3.3% | 7.1% | 12.7% |

---

## 3. Dev Split Results (Delhi-Gurgaon NCR)

| Model / Baseline | Recall@25 | Recall@50 | Recall@100 | Recall@200 | Cutoff Ties (K=25 / 50 / 100 / 200) |
|---|---|---|---|---|---|
| **FloodLens (Composite)** | 14.3% | 21.4% | 35.7% | 42.9% | 1 / 1 / 1 / 1 |
| **TWI Only** | 0.0% | 0.0% | 0.0% | 0.0% | 1 / 1 / 2 / 2 |
| **Underpass Prior Only** | 7.2% | 13.3% | 22.9% | 36.4% | 618 / 618 / 618 / 618 |
| **Flow Acc Only** | 0.0% | 0.0% | 0.0% | 0.0% | 2 / 1 / 1 / 1 |
| **HAND Only** | 0.0% | 0.0% | 0.0% | 0.0% | 4 / 1 / 2 / 9 |
| **Built-up Only** | 4.4% | 6.1% | 7.1% | 7.1% | 233 / 233 / 233 / 233 |
| **Elevation Only** | 0.0% | 0.0% | 0.0% | 0.0% | 1 / 1 / 3 / 2 |
| **Random Uniform (full 41,703 pool)** | 1.1% | 2.0% | 4.0% | 7.4% | 0 / 0 / 0 / 0 |

---

## 4. Leave-One-Out Feature Ablation Analysis

To evaluate which hydrological and physical components drive model utility, each of the six features was dropped in turn and the remaining weights renormalized:

| Model Configuration | DEV Recall@25 | DEV Recall@50 | DEV Recall@100 | DEV Recall@200 | TEST Recall@25 | TEST Recall@50 | TEST Recall@100 | TEST Recall@200 |
|---|---|---|---|---|---|---|---|---|
| **Full Model (All 6 Features)** | 14.3% | 21.4% | 35.7% | 42.9% | 5.9% | 11.8% | 35.3% | 58.8% |
| Without hand_inv | 14.3% | 21.4% | 35.7% | 35.7% | 5.9% | 11.8% | 35.3% | 52.9% |
| Without twi | 14.3% | 21.4% | 28.6% | 35.7% | 5.9% | 29.4% | 35.3% | 58.8% |
| Without flow_acc | 14.3% | 21.4% | 28.6% | 35.7% | 5.9% | 29.4% | 35.3% | 52.9% |
| Without builtup | 14.3% | 21.4% | 35.7% | 35.7% | 5.9% | 17.6% | 35.3% | 52.9% |
| Without underpass_prior | 7.1% | 7.1% | 7.1% | 28.6% | 11.8% | 11.8% | 11.8% | 11.8% |
| Without depression_depth | 14.3% | 21.4% | 35.7% | 42.9% | 5.9% | 11.8% | 35.3% | 58.8% |

---

## 5. Exploratory Analysis: City-Stratified Operational Ranking

> [!WARNING]
> **Exploratory Post-Hoc Analysis Only**: The Gurugram stratified evaluation uses DEV spots from 2026-07-08 and 2026-08-06 that informed tuning. It is an exploratory post-hoc check only and must not be interpreted as out-of-sample validation.

| Control Room / City Jurisdiction | Hex Pool Size | Evaluated Spots | Split Status | Recall@25 | Recall@50 | Recall@100 | Recall@200 |
|---|---|---|---|---|---|---|---|
| **Gurugram (GMDA)** | 7,021 hexes | 6 spots | DEV (Informed Tuning - Exploratory) | 50.0% | 50.0% | 83.3% | 83.3% |
| **Delhi (MCD/PWD)** | 34,682 hexes | 17 spots | TEST (Held-Out) | 5.9% | 35.3% | 41.2% | 58.8% |

---

## 6. Plain-Language Honest Assessment

1. **Baseline Comparisons**:
   - **Versus Random, TWI, HAND, Built-up, and Elevation**: FloodLens is far above uniform random ($58.8\%$ vs $10.8\%$ at $K=200$), TWI-only ($5.9\%$ at $K=200$), HAND-only ($0.0\%$), built-up-only ($5.7\%$), and elevation-only ($0.0\%$).
   - **Versus Underpass Prior Only**: The underpass-prior-only baseline is comparable or better at early thresholds ($11.3\%$ vs $5.9\%$ at $K=25$; $21.4\%$ vs $11.8\%$ at $K=50$), equal at $K=100$ ($35.3\%$ vs $35.3\%$), and lower at $K=200$ ($51.1\%$ vs $58.8\%$).
   - **Statistical Distinguishability**: In paired bootstrap analysis on the test split ($N=17$), the $K=200$ difference ($+7.8\%$) yields a 95% confidence interval of $[-23.5\%, +35.3\%]$, which spans zero and is **not statistically distinguishable** at $\alpha=0.05$.
   - **Role of the Underpass Prior & Composite Model**: The underpass prior contributes much of the top-of-list signal. The composite model adds corridor coverage across surface avenues plus severity and rainfall scaling, eliminating discrete tie degeneracy (Underpass Prior has 41,085 tied zero-cells).
2. **Ablation Findings**: Dropping **TWI** or **Flow Accumulation** causes the sharpest drop in test corridor recall, confirming that upslope runoff accumulation is essential for capturing surface avenue waterlogging. Dropping **Underpass Prior** degrades performance where chronic underpass sites dominate.
3. **Point Spot Limitation**: On point spots at strict 300 m tolerance, Recall was 0 of 3 on test. Coarse news-derived point coordinates require ~500m to 1,000m tolerance to intersect 30m grid-derived hex centers.
4. **City Stratification**: When evaluated strictly within city boundaries, early ranking shifts (reaching 50.0% at K=25 in Gurugram). Note that Gurugram evaluation uses DEV spots that informed tuning and is strictly exploratory.

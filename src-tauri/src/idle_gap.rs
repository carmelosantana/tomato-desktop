//! Remember idle stretches that end between the webview's ticks.
//!
//! The tick loop runs in a hidden webview and is sparse (measured ~0.5 Hz on
//! GNOME, and it can stall), so the one tick that would have seen
//! `idle >= idle_reset` may never land: a break of about the reset length is then
//! missed and the sprint keeps counting. A native thread samples idle time
//! faster and keeps the longest stretch that ended since the webview last asked.

use serde::Serialize;

/// A completed idle stretch, in wall-clock milliseconds since the UNIX epoch.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gap {
    pub start_at: f64,
    pub len_ms: f64,
}

#[derive(Debug, Default)]
pub struct GapTracker {
    /// The previous sample: (wall-clock ms, idle ms).
    prev: Option<(f64, f64)>,
    longest: Option<Gap>,
}

impl GapTracker {
    /// Feed one sample. When idle drops, input arrived and the stretch that the
    /// previous sample was in has ended; record it (its length is at least the
    /// previous idle reading — a conservative lower bound).
    pub fn observe(&mut self, now_ms: f64, idle_ms: f64) {
        if let Some((prev_now, prev_idle)) = self.prev {
            if idle_ms < prev_idle {
                let gap = Gap { start_at: prev_now - prev_idle, len_ms: prev_idle };
                if self.longest.map_or(true, |g| gap.len_ms > g.len_ms) {
                    self.longest = Some(gap);
                }
            }
        }
        self.prev = Some((now_ms, idle_ms));
    }

    /// Hand over the longest completed stretch since the last call, and forget it.
    pub fn take(&mut self) -> Option<Gap> {
        self.longest.take()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rising_idle_records_nothing() {
        let mut t = GapTracker::default();
        t.observe(1_000.0, 0.0);
        t.observe(2_000.0, 1_000.0);
        assert_eq!(t.take(), None);
    }

    #[test]
    fn a_drop_records_the_stretch_that_ended() {
        let mut t = GapTracker::default();
        t.observe(10_000.0, 0.0);
        t.observe(70_000.0, 60_000.0); // idle since 10_000
        t.observe(70_500.0, 100.0); // input arrived
        assert_eq!(t.take(), Some(Gap { start_at: 10_000.0, len_ms: 60_000.0 }));
        assert_eq!(t.take(), None, "taken once");
    }

    #[test]
    fn keeps_the_longest_of_several() {
        let mut t = GapTracker::default();
        t.observe(0.0, 0.0);
        t.observe(30_000.0, 30_000.0);
        t.observe(30_250.0, 0.0);
        t.observe(100_000.0, 65_000.0);
        t.observe(100_250.0, 0.0);
        t.observe(110_000.0, 9_000.0);
        t.observe(110_250.0, 0.0);
        assert_eq!(t.take(), Some(Gap { start_at: 35_000.0, len_ms: 65_000.0 }));
    }
}

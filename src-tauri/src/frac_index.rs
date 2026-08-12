//! Fractional indexing over base-62 strings.
//!
//! A direct port of `src/core/fracIndex.ts`, kept character-for-character
//! equivalent so a library written by one build opens in the other. The tests
//! at the bottom mirror `src/core/fracIndex.test.ts`.

const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// A key strictly between `a` and `b`. `None` means "before everything" on the
/// left and "after everything" on the right.
pub fn key_between(a: Option<&str>, b: Option<&str>) -> String {
    if let (Some(left), Some(right)) = (a, b) {
        assert!(left < right, "key_between: disordered bounds {left} >= {right}");
    }
    midpoint(a.unwrap_or(""), b)
}

fn midpoint(a: &str, b: Option<&str>) -> String {
    if let Some(right) = b {
        // Strip the longest common prefix and recurse on the remainder.
        let mut n = 0;
        let left_bytes = a.as_bytes();
        let right_bytes = right.as_bytes();
        while n < right_bytes.len() {
            let from_left = *left_bytes.get(n).unwrap_or(&b'0');
            if from_left != right_bytes[n] {
                break;
            }
            n += 1;
        }
        if n > 0 {
            return format!("{}{}", &right[..n], midpoint(&a[n.min(a.len())..], Some(&right[n..])));
        }
    }

    let digit_a = a.bytes().next().map_or(0, index_of);
    let digit_b = b
        .and_then(|right| right.bytes().next())
        .map_or(DIGITS.len(), index_of);

    if digit_b - digit_a > 1 {
        let middle = ((digit_a + digit_b) as f64 * 0.5).round() as usize;
        return (DIGITS[middle] as char).to_string();
    }

    // First digits are adjacent: borrow depth from whichever side has room.
    if let Some(right) = b {
        if right.len() > 1 {
            return right[..1].to_string();
        }
    }
    let rest = if a.is_empty() { "" } else { &a[1..] };
    format!("{}{}", DIGITS[digit_a] as char, midpoint(rest, None))
}

fn index_of(byte: u8) -> usize {
    DIGITS
        .iter()
        .position(|candidate| *candidate == byte)
        .expect("position keys only ever contain base-62 digits")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_keys_that_sort_between_their_bounds() {
        let first = key_between(None, None);
        let before = key_between(None, Some(&first));
        let after = key_between(Some(&first), None);
        assert!(before < first, "{before} < {first}");
        assert!(first < after, "{first} < {after}");
        let middle = key_between(Some(&before), Some(&first));
        assert!(before < middle && middle < first);
    }

    #[test]
    fn never_runs_out_of_room_between_two_neighbours() {
        // Floats tie after about fifty of these. Strings must not.
        let mut low = key_between(None, None);
        let high = key_between(Some(&low), None);
        for round in 0..500 {
            let next = key_between(Some(&low), Some(&high));
            assert!(low < next && next < high, "collapsed at round {round}");
            low = next;
        }
    }

    #[test]
    fn matches_the_typescript_implementation() {
        // Values taken from src/core/fracIndex.test.ts.
        assert_eq!(key_between(None, None), "V");
        assert_eq!(key_between(None, Some("V")), "G");
        assert_eq!(key_between(Some("V"), None), "l");
    }
}

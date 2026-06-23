package denom

import "testing"

func TestToBase(t *testing.T) {
	cases := []struct {
		in       string
		exponent int
		want     string
	}{
		{"1", 6, "1000000"},
		{"1.5", 6, "1500000"},
		{"0.1", 6, "100000"},
		{"0.000001", 6, "1"},
		{"0", 6, "0"},
		{"  2.25  ", 6, "2250000"},
		{"+3", 6, "3000000"},
		{"123456789", 6, "123456789000000"},
		{"5", 0, "5"},
		{"1.5", 2, "150"},
	}
	for _, c := range cases {
		got, err := ToBase(c.in, c.exponent)
		if err != nil {
			t.Errorf("ToBase(%q,%d) error: %v", c.in, c.exponent, err)
			continue
		}
		if got != c.want {
			t.Errorf("ToBase(%q,%d) = %q, want %q", c.in, c.exponent, got, c.want)
		}
	}
}

func TestToBaseRejects(t *testing.T) {
	cases := []struct {
		in       string
		exponent int
	}{
		{"-1", 6},
		{"abc", 6},
		{"1.2.3", 6},
		{"1e6", 6},
		{"1,000", 6},
		{"0.1234567", 6}, // over-precision
		{"", 6},
		{"1.0", -1}, // bad exponent
	}
	for _, c := range cases {
		if _, err := ToBase(c.in, c.exponent); err == nil {
			t.Errorf("ToBase(%q,%d) expected error", c.in, c.exponent)
		}
	}
}

func TestFromBase(t *testing.T) {
	cases := []struct {
		in       string
		exponent int
		want     string
	}{
		{"1000000", 6, "1"},
		{"1500000", 6, "1.5"},
		{"1", 6, "0.000001"},
		{"0", 6, "0"},
		{"100000", 6, "0.1"},
		{"123456789000000", 6, "123456789"},
		{"5", 0, "5"},
		{"150", 2, "1.5"},
		{"  42  ", 0, "42"},
	}
	for _, c := range cases {
		got, err := FromBase(c.in, c.exponent)
		if err != nil {
			t.Errorf("FromBase(%q,%d) error: %v", c.in, c.exponent, err)
			continue
		}
		if got != c.want {
			t.Errorf("FromBase(%q,%d) = %q, want %q", c.in, c.exponent, got, c.want)
		}
	}
}

func TestFromBaseRejects(t *testing.T) {
	for _, in := range []string{"-1", "abc", "1.5", ""} {
		if _, err := FromBase(in, 6); err == nil {
			t.Errorf("FromBase(%q) expected error", in)
		}
	}
}

func TestRoundTrip(t *testing.T) {
	for _, v := range []string{"1", "1.5", "0.000001", "123456789", "0"} {
		base, err := ToBase(v, 6)
		if err != nil {
			t.Fatal(err)
		}
		back, err := FromBase(base, 6)
		if err != nil {
			t.Fatal(err)
		}
		if back != v {
			t.Errorf("round-trip %q -> %q -> %q", v, base, back)
		}
	}
}

pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/comparators.circom";

// Age Check Circuit — Proves age >= threshold without revealing age
// Public inputs:  threshold
// Private inputs: age
// Output:         valid
// Constraint:     valid

template AgeCheck() {
    signal input age;          // private: user's actual age
    signal input threshold;    // public: minimum age requirement

    signal output valid;

    // GreaterEqThan(n) checks if in[0] >= in[1] using n-bit comparison
    // 8 bits supports values 0-255, sufficient for age
    component gte = GreaterEqThan(8);
    gte.in[0] <== age;
    gte.in[1] <== threshold;

    valid <== gte.out;

    // Enforce: the proof can only be generated if the predicate holds
    valid === 1;
}

component main {public [threshold]} = AgeCheck();

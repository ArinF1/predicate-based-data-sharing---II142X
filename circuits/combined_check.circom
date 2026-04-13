pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/comparators.circom";

// Combined Check Circuit — Proves (age >= threshold AND location === target)
// Public inputs:  threshold, target
// Private inputs: age, location
// Output:         valid
// Constraint:     valid === 1

template CombinedCheck() {
    signal input age;          // private
    signal input location;     // private
    signal input threshold;    // public
    signal input target;       // public

    signal output valid;

    // Age >= threshold (8-bit)
    component gte = GreaterEqThan(8);
    gte.in[0] <== age;
    gte.in[1] <== threshold;

    // Location === target
    component eq = IsEqual();
    eq.in[0] <== location;
    eq.in[1] <== target;

    // AND: both must hold
    signal both;
    both <== gte.out * eq.out;

    valid <== both;

    // Enforce: proof only succeeds if both conditions are satisfied
    both === 1;
}

component main {public [threshold, target]} = CombinedCheck();

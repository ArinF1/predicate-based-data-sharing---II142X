pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/comparators.circom";

// Location Check Circuit — Proves location matches target without revealing it
// Public inputs:  target (encoded location, e.g., 'SE' → 21317)
// Private inputs: location (user's actual location as integer)
// Output:         valid (1 if location === target, 0 otherwise)
// Constraint:     valid === 1 (proof fails if location doesn't match)
//
// Encoding: ISO location codes are converted to integers:
//   'SE' → 83 * 256 + 69 = 21317
//   'US' → 85 * 256 + 83 = 21843
//   'DE' → 68 * 256 + 69 = 17477

template LocationCheck() {
    signal input location;     // private
    signal input target;       // public

    signal output valid;

    // IsEqual checks if in[0] === in[1]
    component eq = IsEqual();
    eq.in[0] <== location;
    eq.in[1] <== target;

    valid <== eq.out;

    // the proof can only be generated if location matches
    valid === 1;
}

component main {public [target]} = LocationCheck();

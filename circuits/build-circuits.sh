#!/bin/bash
#Compile Circom circuits and run trusted setup

# circom (Rust), snarkjs (npm), node_modules/circomlib
#   1. Compiles each .circom file to WASM + R1CS
#   2. Runs a powers-of-tau ceremony (BN128, 2^12)
#   3. Generates Groth16 proving + verification keys
#   4. Exports verification keys as JSON

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Circuits to compile
CIRCUITS=("age_check" "location_check" "combined_check")

echo "=== Circuit Build Script ==="
echo "Build directory: $BUILD_DIR"
echo ""

# Create build directory
mkdir -p "$BUILD_DIR"

# Powers of Tau ceremony (shared across all circuits)
PTAU_FILE="$BUILD_DIR/pot12_final.ptau"
if [ ! -f "$PTAU_FILE" ]; then
    echo ">>> Generating Powers of Tau (2^12)..."
    npx snarkjs powersoftau new bn128 12 "$BUILD_DIR/pot12_0000.ptau" -v
    npx snarkjs powersoftau contribute "$BUILD_DIR/pot12_0000.ptau" "$BUILD_DIR/pot12_0001.ptau" \
        --name="First contribution" -v -e="random-entropy-for-research-prototype"
    npx snarkjs powersoftau prepare phase2 "$BUILD_DIR/pot12_0001.ptau" "$PTAU_FILE" -v
    echo ">>> Powers of Tau complete."
    echo ""
else
    echo ">>> Powers of Tau already exists, skipping."
    echo ""
fi

# Compile and setup each circuit
for CIRCUIT in "${CIRCUITS[@]}"; do
    echo "=== Processing circuit: $CIRCUIT ==="

    CIRCOM_FILE="$SCRIPT_DIR/$CIRCUIT.circom"
    CIRCUIT_BUILD="$BUILD_DIR/$CIRCUIT"
    mkdir -p "$CIRCUIT_BUILD"

    # Compile
    if [ ! -f "$CIRCUIT_BUILD/${CIRCUIT}_js/${CIRCUIT}.wasm" ]; then
        echo ">>> Compiling $CIRCUIT.circom..."
        circom "$CIRCOM_FILE" \
            --r1cs \
            --wasm \
            --sym \
            -o "$CIRCUIT_BUILD" \
            -l "$PROJECT_ROOT/node_modules"
        echo ">>> Compilation complete."
    else
        echo ">>> $CIRCUIT already compiled, skipping."
    fi

    # Groth16 setup
    if [ ! -f "$CIRCUIT_BUILD/$CIRCUIT.zkey" ]; then
        echo ">>> Running Groth16 setup for $CIRCUIT..."
        npx snarkjs groth16 setup \
            "$CIRCUIT_BUILD/$CIRCUIT.r1cs" \
            "$PTAU_FILE" \
            "$CIRCUIT_BUILD/${CIRCUIT}_0000.zkey"

        # Contribute to phase 2
        npx snarkjs zkey contribute \
            "$CIRCUIT_BUILD/${CIRCUIT}_0000.zkey" \
            "$CIRCUIT_BUILD/$CIRCUIT.zkey" \
            --name="Research prototype contribution" \
            -e="circuit-specific-entropy-$CIRCUIT"

        echo ">>> Groth16 setup complete."
    else
        echo ">>> $CIRCUIT zkey already exists, skipping."
    fi

    # Export verification key
    if [ ! -f "$CIRCUIT_BUILD/verification_key.json" ]; then
        echo ">>> Exporting verification key for $CIRCUIT..."
        npx snarkjs zkey export verificationkey \
            "$CIRCUIT_BUILD/$CIRCUIT.zkey" \
            "$CIRCUIT_BUILD/verification_key.json"
        echo ">>> Verification key exported."
    else
        echo ">>> Verification key already exists, skipping."
    fi

    echo "=== $CIRCUIT done ==="
    echo ""
done

echo "=== All circuits built successfully ==="
echo ""
echo "Build artifacts:"
for CIRCUIT in "${CIRCUITS[@]}"; do
    echo "  $BUILD_DIR/$CIRCUIT/"
    echo "    - ${CIRCUIT}.wasm (circuit)"
    echo "    - ${CIRCUIT}.zkey (proving key)"
    echo "    - verification_key.json"
done

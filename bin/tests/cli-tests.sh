#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
ORANGE='\033[0;33m'
NC='\033[0m' # No Color

# Track test results
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0
TOTAL_TESTS=0

echo -e "${YELLOW}=== MCP Inspector CLI Test Script ===${NC}"
echo -e "${BLUE}This script tests the MCP Inspector CLI's ability to handle various command line options:${NC}"
echo -e "${BLUE}- Basic CLI mode${NC}"
echo -e "${BLUE}- Environment variables (-e)${NC}"
echo -e "${BLUE}- Config file (--config)${NC}"
echo -e "${BLUE}- Server selection (--server)${NC}"
echo -e "${BLUE}- Method selection (--method)${NC}"
echo -e "${BLUE}- Tool-related options (--tool-name, --tool-arg)${NC}"
echo -e "${BLUE}- Resource-related options (--uri)${NC}"
echo -e "${BLUE}- Prompt-related options (--prompt-name, --prompt-args)${NC}"
echo -e "${BLUE}- Logging options (--log-level)${NC}"
echo ""

# Change to the bin directory
cd "$(dirname "$0")/.."
BIN_DIR="$(pwd)"
PROJECT_ROOT="$(dirname "$BIN_DIR")"

# Compile bin and cli projects
echo -e "${YELLOW}Compiling MCP Inspector bin and cli...${NC}"
cd "$BIN_DIR"
npm run build
cd "$PROJECT_ROOT/cli"
npm run build
cd "$BIN_DIR"

# Create a symbolic link to handle path resolution
echo -e "${YELLOW}Setting up environment for tests...${NC}"
PARENT_DIR="$(dirname "$PROJECT_ROOT")"

# Define the test server command using npx
TEST_CMD="npx"
TEST_ARGS=("@modelcontextprotocol/server-everything")

# Create output directory for test results
OUTPUT_DIR="$BIN_DIR/tests/output"
mkdir -p "$OUTPUT_DIR"

# Create a temporary directory for test files
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM

# Use the existing sample config file
echo -e "${BLUE}Using existing sample config file: $PROJECT_ROOT/sample-config.json${NC}"
cat "$PROJECT_ROOT/sample-config.json"

# Create an invalid config file for testing
echo '{
  "mcpServers": {
    "invalid": {' > "$TEMP_DIR/invalid-config.json"

# Function to run a basic test
run_basic_test() {
    local test_name=$1
    local output_file="$OUTPUT_DIR/${test_name//\//_}.log"
    shift
    
    echo -e "\n${YELLOW}Testing: ${test_name}${NC}"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    # Run the command and capture output
    echo -e "${BLUE}Command: node ${BIN_DIR}/cli.js $*${NC}"
    node "$BIN_DIR/cli.js" "$@" > "$output_file" 2>&1
    local exit_code=$?
    
    # Check if the test passed or failed
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}✓ Test passed: ${test_name}${NC}"
        echo -e "${BLUE}First few lines of output:${NC}"
        head -n 5 "$output_file" | sed 's/^/  /'
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}✗ Test failed: ${test_name}${NC}"
        echo -e "${RED}Error output:${NC}"
        cat "$output_file" | sed 's/^/  /'
        FAILED_TESTS=$((FAILED_TESTS + 1))
        
        # Stop after any error is encountered
        echo -e "${YELLOW}Stopping tests due to error. Please validate and fix before continuing.${NC}"
        exit 1
    fi
}

# Function to run an error test (expected to fail)
run_error_test() {
    local test_name=$1
    local output_file="$OUTPUT_DIR/${test_name//\//_}.log"
    shift
    
    echo -e "\n${YELLOW}Testing error case: ${test_name}${NC}"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    # Run the command and capture output
    echo -e "${BLUE}Command: node ${BIN_DIR}/cli.js $*${NC}"
    node "$BIN_DIR/cli.js" "$@" > "$output_file" 2>&1
    local exit_code=$?
    
    # For error tests, we expect a non-zero exit code
    if [ $exit_code -ne 0 ]; then
        echo -e "${GREEN}✓ Error test passed: ${test_name}${NC}"
        echo -e "${BLUE}Error output (expected):${NC}"
        head -n 5 "$output_file" | sed 's/^/  /'
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}✗ Error test failed: ${test_name} (expected error but got success)${NC}"
        echo -e "${RED}Output:${NC}"
        cat "$output_file" | sed 's/^/  /'
        FAILED_TESTS=$((FAILED_TESTS + 1))
        
        # Stop after any error is encountered
        echo -e "${YELLOW}Stopping tests due to error. Please validate and fix before continuing.${NC}"
        exit 1
    fi
}

echo -e "\n${YELLOW}=== Running Basic CLI Mode Tests ===${NC}"

# Test 1: Basic CLI mode with method
run_basic_test "basic_cli_mode" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli" "--method" "tools/list"

# Test 2: CLI mode with non-existent method (should fail)
run_error_test "nonexistent_method" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli" "--method" "nonexistent/method"

# Test 3: CLI mode without method (should fail)
run_error_test "missing_method" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli"

echo -e "\n${YELLOW}=== Running Environment Variable Tests ===${NC}"

# Test 4: CLI mode with environment variables
run_basic_test "env_variables" "${TEST_CMD}" "${TEST_ARGS[@]}" "-e" "KEY1=value1" "-e" "KEY2=value2" "--cli" "--method" "tools/list"

# Test 5: CLI mode with invalid environment variable format (should fail)
run_error_test "invalid_env_format" "${TEST_CMD}" "${TEST_ARGS[@]}" "-e" "INVALID_FORMAT" "--cli" "--method" "tools/list"

echo -e "\n${YELLOW}=== Running Config File Tests ===${NC}"

# Test 6: Using config file with CLI mode
run_basic_test "config_file" "--config" "$PROJECT_ROOT/sample-config.json" "--server" "everything" "--cli" "--method" "tools/list"

# Test 7: Using config file without server name (should fail)
run_error_test "config_without_server" "--config" "$PROJECT_ROOT/sample-config.json" "--cli" "--method" "tools/list"

# Test 8: Using server name without config file (should fail)
run_error_test "server_without_config" "--server" "everything" "--cli" "--method" "tools/list"

# Test 9: Using non-existent config file (should fail)
run_error_test "nonexistent_config" "--config" "./nonexistent-config.json" "--server" "everything" "--cli" "--method" "tools/list"

# Test 10: Using invalid config file format (should fail)
run_error_test "invalid_config" "--config" "$TEMP_DIR/invalid-config.json" "--server" "everything" "--cli" "--method" "tools/list"

# Test 11: Using config file with non-existent server (should fail)
run_error_test "nonexistent_server" "--config" "$PROJECT_ROOT/sample-config.json" "--server" "nonexistent" "--cli" "--method" "tools/list"

echo -e "\n${YELLOW}=== Running Tool-Related Tests ===${NC}"

# Test 12: CLI mode with tool call
run_basic_test "tool_call" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli" "--method" "tools/call" "--tool-name" "echo" "--tool-arg" "message=Hello"

# Test 13: CLI mode with tool call but missing tool name (should fail)
run_error_test "missing_tool_name" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli" "--method" "tools/call" "--tool-arg" "message=Hello"

# Test 14: CLI mode with tool call but invalid tool args format (should fail)
run_error_test "invalid_tool_args" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli" "--method" "tools/call" "--tool-name" "echo" "--tool-arg" "invalid_format"

# Test 15: CLI mode with multiple tool args
run_basic_test "multiple_tool_args" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli" "--method" "tools/call" "--tool-name" "add" "--tool-arg" "a=1" "b=2"

echo -e "\n${YELLOW}=== Running Resource-Related Tests ===${NC}"

# Test 16: CLI mode with resource read
run_basic_test "resource_read" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli" "--method" "resources/read" "--uri" "test://static/resource/1"

# Test 17: CLI mode with resource read but missing URI (should fail)
run_error_test "missing_uri" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli" "--method" "resources/read"

echo -e "\n${YELLOW}=== Running Prompt-Related Tests ===${NC}"

# Test 18: CLI mode with prompt get
run_basic_test "prompt_get" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli" "--method" "prompts/get" "--prompt-name" "simple_prompt"

# Test 19: CLI mode with prompt get and args
run_basic_test "prompt_get_with_args" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli" "--method" "prompts/get" "--prompt-name" "complex_prompt" "--prompt-args" "temperature=0.7" "style=concise"

# Test 20: CLI mode with prompt get but missing prompt name (should fail)
run_error_test "missing_prompt_name" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli" "--method" "prompts/get"

echo -e "\n${YELLOW}=== Running Logging Tests ===${NC}"

# Test 21: CLI mode with log level
run_basic_test "log_level" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli" "--method" "logging/setLevel" "--log-level" "debug"

# Test 22: CLI mode with invalid log level (should fail)
run_error_test "invalid_log_level" "${TEST_CMD}" "${TEST_ARGS[@]}" "--cli" "--method" "logging/setLevel" "--log-level" "invalid"

echo -e "\n${YELLOW}=== Running Combined Option Tests ===${NC}"

# Note about the combined options issue
echo -e "${BLUE}Testing combined options with environment variables and config file.${NC}"

# Test 23: CLI mode with config file, environment variables, and tool call
run_basic_test "combined_options" "--config" "$PROJECT_ROOT/sample-config.json" "--server" "everything" "-e" "CLI_ENV_VAR=cli_value" "--cli" "--method" "tools/list"

# Test 24: CLI mode with all possible options (that make sense together)
run_basic_test "all_options" "--config" "$PROJECT_ROOT/sample-config.json" "--server" "everything" "-e" "CLI_ENV_VAR=cli_value" "--cli" "--method" "tools/call" "--tool-name" "echo" "--tool-arg" "message=Hello" "--log-level" "debug"

# Print test summary
echo -e "\n${YELLOW}=== Test Summary ===${NC}"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"
echo -e "${ORANGE}Skipped: $SKIPPED_TESTS${NC}"
echo -e "Total: $TOTAL_TESTS"
echo -e "${BLUE}Detailed logs saved to: $OUTPUT_DIR${NC}"

echo -e "\n${GREEN}All tests completed!${NC}" 
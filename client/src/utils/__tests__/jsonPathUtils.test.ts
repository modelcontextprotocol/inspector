import { updateValueAtPath, getValueAtPath } from "../jsonPathUtils";
import { JsonValue } from "../../components/DynamicJsonForm";

describe("updateValueAtPath", () => {
  // Basic functionality tests
  test("returns the new value when path is empty", () => {
    expect(updateValueAtPath({ foo: "bar" }, [], "newValue")).toBe("newValue");
  });

  test("initializes an empty object when input is null/undefined and path starts with a string", () => {
    expect(updateValueAtPath(null as any, ["foo"], "bar")).toEqual({
      foo: "bar",
    });
    expect(updateValueAtPath(undefined as any, ["foo"], "bar")).toEqual({
      foo: "bar",
    });
  });

  test("initializes an empty array when input is null/undefined and path starts with a number", () => {
    expect(updateValueAtPath(null as any, ["0"], "bar")).toEqual(["bar"]);
    expect(updateValueAtPath(undefined as any, ["0"], "bar")).toEqual(["bar"]);
  });

  // Object update tests
  test("updates a simple object property", () => {
    const obj = { name: "John", age: 30 };
    expect(updateValueAtPath(obj, ["age"], 31)).toEqual({
      name: "John",
      age: 31,
    });
  });

  test("updates a nested object property", () => {
    const obj = { user: { name: "John", address: { city: "New York" } } };
    expect(
      updateValueAtPath(obj, ["user", "address", "city"], "Boston"),
    ).toEqual({ user: { name: "John", address: { city: "Boston" } } });
  });

  test("creates missing object properties", () => {
    const obj = { user: { name: "John" } };
    expect(
      updateValueAtPath(obj, ["user", "address", "city"], "Boston"),
    ).toEqual({ user: { name: "John", address: { city: "Boston" } } });
  });

  // Array update tests
  test("updates an array item", () => {
    const arr = [1, 2, 3, 4];
    expect(updateValueAtPath(arr, ["2"], 5)).toEqual([1, 2, 5, 4]);
  });

  test("extends an array when index is out of bounds", () => {
    const arr = [1, 2, 3];
    const result = updateValueAtPath(arr, ["5"], "new") as JsonValue[];

    // Check overall array structure
    expect(result).toEqual([1, 2, 3, null, null, "new"]);

    // Explicitly verify that indices 3 and 4 contain null, not undefined
    expect(result[3]).toBe(null);
    expect(result[4]).toBe(null);

    // Verify these aren't "holes" in the array (important distinction)
    expect(3 in result).toBe(true);
    expect(4 in result).toBe(true);

    // Verify the array has the correct length
    expect(result.length).toBe(6);

    // Verify the array doesn't have holes by checking every index exists
    expect(result.every((_, index: number) => index in result)).toBe(true);
  });

  test("updates a nested array item", () => {
    const obj = { users: [{ name: "John" }, { name: "Jane" }] };
    expect(updateValueAtPath(obj, ["users", "1", "name"], "Janet")).toEqual({
      users: [{ name: "John" }, { name: "Janet" }],
    });
  });

  // Error handling tests
  test("returns original value when trying to update a primitive with a path", () => {
    const spy = jest.spyOn(console, "error").mockImplementation();
    const result = updateValueAtPath("string", ["foo"], "bar");
    expect(result).toBe("string");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("returns original array when index is invalid", () => {
    const spy = jest.spyOn(console, "error").mockImplementation();
    const arr = [1, 2, 3];
    expect(updateValueAtPath(arr, ["invalid"], 4)).toEqual(arr);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("returns original array when index is negative", () => {
    const spy = jest.spyOn(console, "error").mockImplementation();
    const arr = [1, 2, 3];
    expect(updateValueAtPath(arr, ["-1"], 4)).toEqual(arr);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("handles sparse arrays correctly by filling holes with null", () => {
    // Create a sparse array by deleting an element
    const sparseArr = [1, 2, 3];
    delete sparseArr[1]; // Now sparseArr is [1, <1 empty item>, 3]

    // Update a value beyond the array length
    const result = updateValueAtPath(sparseArr, ["5"], "new") as JsonValue[];

    // Check overall array structure
    expect(result).toEqual([1, null, 3, null, null, "new"]);

    // Explicitly verify that index 1 (the hole) contains null, not undefined
    expect(result[1]).toBe(null);

    // Verify this isn't a hole in the array
    expect(1 in result).toBe(true);

    // Verify all indices contain null (not undefined)
    expect(result[1]).not.toBe(undefined);
    expect(result[3]).toBe(null);
    expect(result[4]).toBe(null);
  });
});

describe("getValueAtPath", () => {
  test("returns the original value when path is empty", () => {
    const obj = { foo: "bar" };
    expect(getValueAtPath(obj, [])).toBe(obj);
  });

  test("returns the value at a simple path", () => {
    const obj = { name: "John", age: 30 };
    expect(getValueAtPath(obj, ["name"])).toBe("John");
  });

  test("returns the value at a nested path", () => {
    const obj = { user: { name: "John", address: { city: "New York" } } };
    expect(getValueAtPath(obj, ["user", "address", "city"])).toBe("New York");
  });

  test("returns default value when path does not exist", () => {
    const obj = { user: { name: "John" } };
    expect(getValueAtPath(obj, ["user", "address", "city"], "Unknown")).toBe(
      "Unknown",
    );
  });

  test("returns default value when input is null/undefined", () => {
    expect(getValueAtPath(null as any, ["foo"], "default")).toBe("default");
    expect(getValueAtPath(undefined as any, ["foo"], "default")).toBe(
      "default",
    );
  });

  test("handles array indices correctly", () => {
    const arr = ["a", "b", "c"];
    expect(getValueAtPath(arr, ["1"])).toBe("b");
  });

  test("returns default value for out of bounds array indices", () => {
    const arr = ["a", "b", "c"];
    expect(getValueAtPath(arr, ["5"], "default")).toBe("default");
  });

  test("returns default value for invalid array indices", () => {
    const arr = ["a", "b", "c"];
    expect(getValueAtPath(arr, ["invalid"], "default")).toBe("default");
  });

  test("navigates through mixed object and array paths", () => {
    const obj = { users: [{ name: "John" }, { name: "Jane" }] };
    expect(getValueAtPath(obj, ["users", "1", "name"])).toBe("Jane");
  });
});

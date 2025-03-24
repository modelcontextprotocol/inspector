import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, jest } from '@jest/globals';
import DynamicJsonForm from '../DynamicJsonForm';
import type { JsonSchemaType } from '../DynamicJsonForm';

describe('DynamicJsonForm Integer Fields', () => {
  const renderForm = (props = {}) => {
    const defaultProps = {
      schema: {
        type: "integer" as const,
        description: "Test integer field"
      } satisfies JsonSchemaType,
      value: undefined,
      onChange: jest.fn()
    };
    return render(<DynamicJsonForm {...defaultProps} {...props} />);
  };

  describe('Basic Operations', () => {
    it('should render number input with step=1', () => {
      renderForm();
      const input = screen.getByRole('spinbutton');
      expect(input).toHaveProperty('type', 'number');
      expect(input).toHaveProperty('step', '1');
    });

    it('should pass integer values to onChange', () => {
      const onChange = jest.fn();
      renderForm({ onChange });
      
      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '42' } });
      
      expect(onChange).toHaveBeenCalledWith(42);
      // Verify the value is a number, not a string
      expect(typeof onChange.mock.calls[0][0]).toBe('number');
    });

    it('should not pass string values to onChange', () => {
      const onChange = jest.fn();
      renderForm({ onChange });
      
      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: 'abc' } });
      
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-numeric input by not calling onChange', () => {
      const onChange = jest.fn();
      renderForm({ onChange });
      
      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: 'abc' } });
      
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});

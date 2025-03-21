import { Textarea } from "@/components/ui/textarea";
import { JsonSchemaType } from "./DynamicJsonForm";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface Props {
  id: string;
  name: string;
  property: JsonSchemaType;
  value: string;
  onChange: (value: string) => void;
}

export const StringInput = ({ id, name, property, value, onChange }: Props) => {
  if (property.enum?.length) {
    return (
      <Select
        value={value}
        onValueChange={(value) => {
          onChange(value);
        }}
      >
        <SelectTrigger id={id} name={name}>
          <SelectValue placeholder={property.description} />
        </SelectTrigger>
        <SelectContent>
          {property.enum.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Textarea
      id={id}
      name={name}
      placeholder={property.description}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
};

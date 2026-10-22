import Ajv2020 from "ajv/dist/2020";
import {Checkbox, Field, Input, Select, Textarea} from "../ui/components/Field";

/**
 * The form of the arguments of a call the user may edit before approving it,
 * built from the input schema of its tool: its labels and descriptions come
 * from the MCP, the text of the model only as the values filled in.
 */

const typeOf = (property) =>
    Array.isArray(property?.type) ? property.type.find((type) => type !== "null") : property?.type;

// The control a property is edited with.
export const fieldKind = (property, value, mediaType) => {
    if (Array.isArray(property?.enum) && property.enum.length && property.enum.every((item) => typeof item === "string"))
        return "enum";
    switch (typeOf(property)) {
        case "string":
            // A text of a media type, such as a YAML, or holding line breaks,
            // keeps its lines and indentation.
            return mediaType || property.contentMediaType || (typeof value === "string" && value.includes("\n"))
                ? "text"
                : "string";
        case "integer":
        case "number":
            return "number";
        case "boolean":
            return "boolean";
        case "array":
            return typeOf(property.items) === "string" ? "lines" : "json";
        default:
            return "json";
    }
};

// The fields of the form: the properties of the schema, in its order, then
// any argument it does not declare.
export const formFields = (schema, args, argumentTypes = {}) => {
    const properties = schema?.properties && typeof schema.properties === "object" ? schema.properties : {};
    const names = [...Object.keys(properties), ...Object.keys(args).filter((name) => !Object.hasOwn(properties, name))];
    const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
    return names.map((name) => {
        const property = Object.hasOwn(properties, name) ? properties[name] : {};
        const mediaType = Object.hasOwn(argumentTypes, name) ? argumentTypes[name] : "";
        return {
            name,
            kind: fieldKind(property, args[name], mediaType),
            mediaType,
            required: required.has(name),
            description: typeof property.description === "string" ? property.description : "",
            options: Array.isArray(property.enum) ? property.enum : [],
        };
    });
};

// The text a control shows for a value.
export const draftOf = (field, value) => {
    if (value === undefined || value === null) return field.kind === "boolean" ? false : "";
    switch (field.kind) {
        case "boolean":
            return value === true;
        case "lines":
            return Array.isArray(value) ? value.join("\n") : JSON.stringify(value);
        case "json":
            return JSON.stringify(value, null, 2);
        case "number":
            return String(value);
        default:
            return typeof value === "string" ? value : JSON.stringify(value);
    }
};

// The arguments the drafts give, a full replacement of the proposed ones: a
// field left empty that the call did not set stays unset. It gives the
// errors of the controls that hold no value of their type.
export const argumentsOf = (fields, drafts, proposed) => {
    const result = {};
    const errors = {};
    for (const field of fields) {
        const draft = drafts[field.name];
        const unset = proposed[field.name] === undefined;
        switch (field.kind) {
            case "boolean":
                if (!(unset && draft === false)) result[field.name] = draft === true;
                break;
            case "number":
                if (draft.trim() === "") break;
                if (!Number.isFinite(Number(draft))) errors[field.name] = "A number is required.";
                else result[field.name] = Number(draft);
                break;
            case "lines": {
                const lines = draft.split("\n").filter((line) => line.trim() !== "");
                if (!(unset && lines.length === 0)) result[field.name] = lines;
                break;
            }
            case "json":
                if (draft.trim() === "") break;
                try {
                    result[field.name] = JSON.parse(draft);
                } catch {
                    errors[field.name] = "Valid JSON is required.";
                }
                break;
            default:
                if (!(unset && draft === "")) result[field.name] = draft;
        }
    }
    return {args: result, errors};
};

// A JSON text of a value, its keys sorted, to compare two arguments.
const canonical = (value) =>
    JSON.stringify(value, (_key, item) =>
        item && typeof item === "object" && !Array.isArray(item)
            ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
            : item
    );
export const sameArguments = (a, b) => canonical(a) === canonical(b);

// The validator of the input schema, or null when it cannot be compiled: the
// agent checks the arguments again.
export const compileSchema = (schema) => {
    try {
        // eslint-disable-next-line no-unused-vars
        const {$schema, ...rest} = schema;
        return new Ajv2020({allErrors: true, strict: false, validateFormats: false}).compile(rest);
    } catch {
        return null;
    }
};

// The errors of a validation, by field, the others under "".
export const schemaErrors = (validate, args) => {
    if (!validate || validate(args)) return {};
    const errors = {};
    for (const error of validate.errors || []) {
        const name =
            error.keyword === "required"
                ? error.params?.missingProperty
                : error.keyword === "additionalProperties"
                    ? error.params?.additionalProperty
                    : error.instancePath.split("/")[1] || "";
        const message = error.keyword === "required" ? "A value is required." : error.message;
        errors[name || ""] = errors[name || ""] || message;
    }
    return errors;
};

/** The controls of the form, one per field. */
export default function AiArgumentsForm({fields, drafts, errors, disabled, onChange}) {
    return (
        <div className="space-y-2 text-data">
            {fields.map((field) => {
                const label = (
                    <span>
                        <code>{field.name}</code>
                        {field.required && <span aria-hidden="true"> *</span>}
                        {field.mediaType && <span className="ml-2 font-normal text-ink-muted">{field.mediaType}</span>}
                    </span>
                );
                const value = drafts[field.name];
                const set = (next) => onChange(field.name, next);
                if (field.kind === "boolean")
                    return (
                        <div key={field.name}>
                            <Checkbox
                                label={label}
                                checked={value}
                                disabled={disabled}
                                aria-required={field.required || undefined}
                                onChange={(event) => set(event.target.checked)}
                            />
                            {field.description && <p className="mt-1 text-ink-muted">{field.description}</p>}
                            {errors[field.name] && <p className="mt-1 text-state-down">{errors[field.name]}</p>}
                        </div>
                    );
                return (
                    <Field
                        key={field.name}
                        label={label}
                        hint={field.description || (field.kind === "lines" ? "One value per line." : undefined)}
                        error={errors[field.name]}
                    >
                        {(control) => {
                            const common = {...control, disabled, "aria-required": field.required || undefined};
                            switch (field.kind) {
                                case "enum":
                                    return (
                                        <Select {...common} value={value} onChange={(event) => set(event.target.value)}>
                                            {!field.required && <option value="">—</option>}
                                            {field.options.map((option) => (
                                                <option key={option} value={option}>
                                                    {option}
                                                </option>
                                            ))}
                                        </Select>
                                    );
                                case "number":
                                    return <Input {...common} inputMode="decimal" value={value} onChange={(event) => set(event.target.value)}/>;
                                case "string":
                                    return <Input {...common} value={value} onChange={(event) => set(event.target.value)}/>;
                                default:
                                    return (
                                        <Textarea
                                            {...common}
                                            rows={Math.min(12, Math.max(3, value.split("\n").length))}
                                            spellCheck={false}
                                            className="resize-y font-mono whitespace-pre"
                                            value={value}
                                            onChange={(event) => set(event.target.value)}
                                        />
                                    );
                            }
                        }}
                    </Field>
                );
            })}
            {errors[""] && <p role="alert" className="text-state-down">{errors[""]}</p>}
        </div>
    );
}

import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import type { CompleteFrom } from "@clfly/core";
import { useEffect, useState } from "react";
import {
  buildArgv,
  commandLine,
  displayPath,
  formPositionals,
  isDestructive,
  type FormValues,
  type Route,
  type Tree,
} from "../lib/model";
import { FavoriteActions } from "./FavoriteActions";
import { ResultView } from "./ResultView";
import { useChoices } from "./useChoices";

interface Field {
  name: string;
  kind: "positional" | "flag";
  type: string;
  description?: string;
  optional: boolean;
  default?: unknown;
  enum?: unknown[];
  completeFrom?: CompleteFrom;
}

function fieldsOf(route: Route): Field[] {
  return [
    ...formPositionals(route).map((p) => ({
      name: p.name,
      kind: "positional" as const,
      type: p.variadic ? "array" : "string",
      description: p.description,
      optional: p.optional,
      completeFrom: p.completeFrom,
    })),
    ...route.flags.map((f) => ({ ...f, kind: "flag" as const })),
  ];
}

function initialValues(fields: Field[], initial: FormValues = {}): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    if (initial[f.name] !== undefined) out[f.name] = initial[f.name]!;
    else out[f.name] = f.type === "boolean" ? f.default === true : "";
  }
  return out;
}

/** Leaf command as a form: enums → dropdowns, booleans → checkboxes, `completeFrom` → filled dropdowns. */
export function CommandForm(props: { tree: Tree; route: Route; params: Record<string, string>; initial?: FormValues }) {
  const { tree, route, params } = props;
  const fields = fieldsOf(route);
  const [values, setValues] = useState<FormValues>(() => initialValues(fields, props.initial));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const { push } = useNavigation();
  const set = (name: string) => (v: string | boolean) => {
    setValues((prev) => ({ ...prev, [name]: v }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  };
  const title = [tree.name, displayPath(route.path, params)].join(" ");
  const argv = buildArgv(route, params, values);

  function submit() {
    const next: Record<string, string> = {};
    for (const f of fields) {
      const v = values[f.name];
      if (f.kind === "positional" && !f.optional && !(typeof v === "string" && v.trim())) next[f.name] = "Required";
      if (f.type === "number" && typeof v === "string" && v.trim() && Number.isNaN(Number(v))) next[f.name] = "Not a number";
    }
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    if (route.meta?.interactive) {
      void showToast({ style: Toast.Style.Failure, title: "Interactive command", message: "Copy the command and run it in a terminal" });
      return;
    }
    push(<ResultView tree={tree} route={route} params={params} values={values} />);
  }

  return (
    <Form
      navigationTitle={title}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={isDestructive(route) ? "Run (asks first)" : "Run"}
            icon={isDestructive(route) ? Icon.Trash : Icon.Play}
            onSubmit={submit}
          />
          <Action.CopyToClipboard title="Copy Command" content={commandLine(tree.name, argv)} shortcut={{ modifiers: ["cmd", "shift"], key: "c" }} />
          <FavoriteActions tree={tree} route={route} params={params} values={values} />
        </ActionPanel>
      }
    >
      <Form.Description title={title} text={route.meta?.description ?? ""} />
      {fields.map((f) => (
        <FieldInput key={f.name} tree={tree} field={f} values={values} error={errors[f.name]} onChange={set(f.name)} />
      ))}
      {fields.length === 0 && <Form.Description text="No arguments. ⌘↵ to run." />}
    </Form>
  );
}

function label(f: Field): string {
  return f.kind === "positional" ? `‹${f.name}›` : `--${f.name}`;
}

function placeholder(f: Field): string {
  if (f.default !== undefined) return `default: ${String(f.default)}`;
  if (f.type === "array") return "comma-separated";
  return f.optional ? "optional" : "required";
}

function FieldInput(props: {
  tree: Tree;
  field: Field;
  values: FormValues;
  error?: string;
  onChange: (v: string | boolean) => void;
}) {
  const { field: f, values, error, onChange } = props;
  const value = values[f.name];
  if (f.completeFrom) return <CompleteDropdown {...props} completeFrom={f.completeFrom} />;
  if (f.type === "boolean") {
    return <Form.Checkbox id={f.name} label={label(f)} info={f.description} value={value === true} onChange={onChange} />;
  }
  if (f.enum?.length) {
    return (
      <Form.Dropdown id={f.name} title={label(f)} info={f.description} value={String(value ?? "")} onChange={onChange} error={error}>
        {f.optional && <Form.Dropdown.Item value="" title={f.default !== undefined ? `(default: ${String(f.default)})` : "(none)"} />}
        {f.enum.map((e) => (
          <Form.Dropdown.Item key={String(e)} value={String(e)} title={String(e)} />
        ))}
      </Form.Dropdown>
    );
  }
  return (
    <Form.TextField
      id={f.name}
      title={label(f)}
      info={f.description}
      placeholder={placeholder(f)}
      value={String(value ?? "")}
      error={error}
      onChange={onChange}
    />
  );
}

/** `$name` references in `args` re-run the source; debounced so typing does not spawn a run per key. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [JSON.stringify(value), ms]);
  return v;
}

function CompleteDropdown(props: {
  tree: Tree;
  field: Field;
  values: FormValues;
  error?: string;
  completeFrom: CompleteFrom;
  onChange: (v: string | boolean) => void;
}) {
  const { tree, field: f, values, error, completeFrom, onChange } = props;
  const refs = Object.fromEntries(
    Object.values(completeFrom.args ?? {})
      .filter((a): a is string => typeof a === "string" && a.startsWith("$"))
      .map((a) => [a.slice(1), values[a.slice(1)]]),
  );
  const debounced = useDebounced(refs, 500);
  const { data: choices = [], isLoading, runnable } = useChoices(tree, completeFrom, debounced);
  const [typed, setTyped] = useState("");
  const value = String(values[f.name] ?? "");
  const extra = [typed.trim(), value].filter((v, i, a) => v && a.indexOf(v) === i && !choices.some((c) => c.value === v));

  return (
    <Form.Dropdown
      id={f.name}
      title={label(f)}
      info={`${f.description ?? ""}\nChoices from: ${completeFrom.cmd}`.trim()}
      value={value}
      onChange={onChange}
      error={error}
      isLoading={isLoading}
      filtering
      onSearchTextChange={setTyped}
    >
      <Form.Dropdown.Item
        value=""
        title={runnable ? (f.optional ? "(none)" : `(pick from ${completeFrom.cmd})`) : `(type a value, or chain from ${completeFrom.cmd} results)`}
      />
      {extra.map((v) => (
        <Form.Dropdown.Item key={`typed-${v}`} value={v} title={v} icon={Icon.Pencil} />
      ))}
      {choices.map((c) => (
        <Form.Dropdown.Item key={c.value} value={c.value} title={c.label ? `${c.label}${c.sub ? ` · ${c.sub}` : ""}` : c.value} keywords={[c.value]} />
      ))}
    </Form.Dropdown>
  );
}

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const runRows = [
  {
    id: "RUN-248",
    task: "Policy gate review",
    runner: "macbook-pro-local",
    validation: "Web build",
    status: "Passed",
    variant: "default" as const,
  },
  {
    id: "RUN-247",
    task: "Manual task packet",
    runner: "macbook-pro-local",
    validation: "Web lint",
    status: "Review",
    variant: "secondary" as const,
  },
  {
    id: "RUN-246",
    task: "Repo mapping smoke",
    runner: "build-station-01",
    validation: "Typecheck",
    status: "Warning",
    variant: "outline" as const,
  },
];

export default function UiBaselinePage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Internal route</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">UI baseline</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">Protected dashboard</Badge>
          <Badge variant="outline">Primitive smoke</Badge>
        </div>
      </header>

      <Tabs defaultValue="intake">
        <TabsList>
          <TabsTrigger value="intake">Intake</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="approval">Approval</TabsTrigger>
        </TabsList>

        <TabsContent value="intake">
          <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
            <form className="flex flex-col gap-5">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="task-title">Task title</FieldLabel>
                  <Input id="task-title" name="task-title" defaultValue="Add validation summary" />
                  <FieldDescription>Short human-approved engineering intent.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="runner">Runner</FieldLabel>
                  <Select defaultValue="macbook-pro-local">
                    <SelectTrigger id="runner">
                      <SelectValue>macbook-pro-local</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Available runners</SelectLabel>
                        <SelectItem value="macbook-pro-local">macbook-pro-local</SelectItem>
                        <SelectItem value="build-station-01">build-station-01</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="acceptance">Acceptance criteria</FieldLabel>
                  <Textarea
                    id="acceptance"
                    name="acceptance"
                    defaultValue={"Validation passes\nRun trace stays metadata-only"}
                  />
                </Field>
              </FieldGroup>

              <FieldSeparator>Queue controls</FieldSeparator>

              <div className="flex flex-wrap gap-2">
                <Button>Approve task</Button>
                <Button variant="outline">Save draft</Button>
              </div>
            </form>

            <aside className="rounded-md border border-border bg-secondary p-4">
              <p className="text-sm font-semibold">Readiness</p>
              <div className="mt-4 flex flex-col gap-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Policy</span>
                  <Badge>Ready</Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Validation</span>
                  <Badge variant="secondary">Required</Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Review</span>
                  <Badge variant="outline">Human</Badge>
                </div>
              </div>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="runs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Runner</TableHead>
                <TableHead>Validation</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runRows.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">{run.id}</TableCell>
                  <TableCell>{run.task}</TableCell>
                  <TableCell>{run.runner}</TableCell>
                  <TableCell>{run.validation}</TableCell>
                  <TableCell>
                    <Badge variant={run.variant}>{run.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="approval">
          <Dialog>
            <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
              <div>
                <h2 className="text-base font-semibold">Approval packet</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Operators can review changed file paths, risk flags, validation status, and PR
                  metadata before deciding the next run state.
                </p>
              </div>
              <DialogTrigger>Inspect packet</DialogTrigger>
            </div>

            <DialogContent className="mt-4">
              <DialogHeader>
                <DialogTitle>Run approval summary</DialogTitle>
                <DialogDescription>
                  This smoke view keeps the client surface limited to operational metadata.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 grid gap-3 text-sm">
                <div className="flex justify-between gap-4 rounded-md bg-secondary px-3 py-2">
                  <span className="text-muted-foreground">Changed paths</span>
                  <span className="font-medium">3</span>
                </div>
                <div className="flex justify-between gap-4 rounded-md bg-secondary px-3 py-2">
                  <span className="text-muted-foreground">Risk flags</span>
                  <span className="font-medium">0 blockers</span>
                </div>
                <div className="flex justify-between gap-4 rounded-md bg-secondary px-3 py-2">
                  <span className="text-muted-foreground">PR state</span>
                  <span className="font-medium">Draft</span>
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button size="sm">Approve</Button>
                <Button size="sm" variant="outline">
                  Request repair
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}

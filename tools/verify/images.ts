/*
 * The sandbox must run the same images CI runs, so they are read out of
 * `.github/workflows/ci.yml` rather than written down a second time here. A
 * digest pin added there is picked up with no change to this file.
 *
 * The parse is indentation-driven rather than a YAML dependency: `tools/` has
 * no dependencies of its own and a `services:` block is a fixed two-level
 * shape. Several jobs declare the same service; they must agree, and a
 * disagreement is reported rather than resolved, because "local runs what CI
 * runs" is the whole point of reading the file.
 */
export type ServiceName = 'postgres' | 'redis' | 's3' | 'mailpit';

export const REQUIRED_SERVICES: readonly ServiceName[] = ['postgres', 'redis', 's3', 'mailpit'];

export type ServiceImages = Readonly<Record<ServiceName, string>>;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Collect `image:` refs per service name from every `services:` block in a workflow. */
export function parseServiceImages(workflowText: string): ServiceImages {
  const found = new Map<string, Set<string>>();
  const lines = workflowText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() !== 'services:') {
      continue;
    }

    const blockIndent = indentOf(line);
    let service: string | null = null;

    for (let j = i + 1; j < lines.length; j++) {
      const inner = lines[j];
      if (inner === undefined) {
        break;
      }
      if (inner.trim() === '' || inner.trimStart().startsWith('#')) {
        continue;
      }
      if (indentOf(inner) <= blockIndent) {
        break;
      }

      const serviceMatch = /^\s{2,}([A-Za-z0-9_-]+):\s*$/u.exec(inner);
      if (serviceMatch?.[1] !== undefined && indentOf(inner) === blockIndent + 2) {
        service = serviceMatch[1];
        continue;
      }

      const imageMatch = /^\s+image:\s*(\S+)\s*$/u.exec(inner);
      if (imageMatch?.[1] !== undefined && service !== null) {
        const refs = found.get(service) ?? new Set<string>();
        refs.add(imageMatch[1]);
        found.set(service, refs);
      }
    }
  }

  const resolve = (name: ServiceName): string => {
    const refs = found.get(name);
    if (refs === undefined || refs.size === 0) {
      throw new Error(
        `No image found for the "${name}" service in the CI workflow. The sandbox runs the images CI runs; add the service there or teach tools/verify/images.ts its new name.`,
      );
    }
    const [first, ...rest] = [...refs];
    if (first === undefined || rest.length > 0) {
      throw new Error(
        `The CI workflow declares the "${name}" service with more than one image (${[...refs].join(', ')}). Pin every job to the same ref so the sandbox cannot pick the wrong one.`,
      );
    }
    return first;
  };

  return {
    postgres: resolve('postgres'),
    redis: resolve('redis'),
    s3: resolve('s3'),
    mailpit: resolve('mailpit'),
  };
}

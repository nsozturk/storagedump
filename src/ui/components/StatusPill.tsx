import type { AccessState, PermissionState } from '@/shared/types';

type PillValue = AccessState | PermissionState;

export function StatusPill({ value }: { value: PillValue }) {
  return <span className={`sd-pill ${value}`}>{value}</span>;
}

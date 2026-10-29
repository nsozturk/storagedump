import type { AccessState, PermissionState, ScanResult } from '@/shared/types';

export function derivePermissionState(scan: ScanResult | null): PermissionState | null {
  if (!scan) {
    return null;
  }

  const states = scan.categories.map((category) => category.permissionState);

  if (states.includes('denied')) {
    return 'denied';
  }

  if (states.includes('required')) {
    return 'required';
  }

  if (states.includes('restricted')) {
    return 'restricted';
  }

  return 'granted';
}

export function deriveAccessState(scan: ScanResult | null): AccessState | null {
  if (!scan) {
    return null;
  }

  const states = scan.categories.map((category) => category.accessState);

  if (states.includes('failed')) {
    return 'failed';
  }

  if (states.includes('restricted')) {
    return 'restricted';
  }

  if (states.includes('partial')) {
    return 'partial';
  }

  if (states.includes('readable')) {
    return 'readable';
  }

  return 'unavailable';
}

export function needsOriginPermission(scan: ScanResult | null): boolean {
  return derivePermissionState(scan) === 'required';
}

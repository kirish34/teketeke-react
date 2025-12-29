export type OperatorType = 'MATATU_SACCO' | 'MATATU_COMPANY' | 'BODA_GROUP' | 'TAXI_FLEET'

export type OperatorConfig = {
  operatorType: OperatorType
  memberLabel: string
  memberIdLabel: string
  memberOwnerLabel: string
  memberLocationLabel?: string
  feeLabel: string
  routesLabel: string
  showTLB: boolean
  showRouteMap: boolean
  showVehicleType: boolean
}

export const defaultOperatorType: OperatorType = 'MATATU_SACCO'

const operatorConfigs: Record<OperatorType, OperatorConfig> = {
  MATATU_SACCO: {
    operatorType: 'MATATU_SACCO',
    memberLabel: 'Matatus',
    memberIdLabel: 'Plate',
    memberOwnerLabel: 'Owner',
    feeLabel: 'Daily Fee',
    routesLabel: 'Routes',
    showTLB: true,
    showRouteMap: true,
    showVehicleType: true,
  },
  MATATU_COMPANY: {
    operatorType: 'MATATU_COMPANY',
    memberLabel: 'Matatus',
    memberIdLabel: 'Plate',
    memberOwnerLabel: 'Owner',
    feeLabel: 'Daily Fee',
    routesLabel: 'Routes',
    showTLB: true,
    showRouteMap: true,
    showVehicleType: true,
  },
  BODA_GROUP: {
    operatorType: 'BODA_GROUP',
    memberLabel: 'Bikes',
    memberIdLabel: 'Bike No',
    memberOwnerLabel: 'Rider/Owner',
    memberLocationLabel: 'Stage/Base',
    feeLabel: 'Stage Fee',
    routesLabel: 'Stages',
    showTLB: false,
    showRouteMap: false,
    showVehicleType: false,
  },
  TAXI_FLEET: {
    operatorType: 'TAXI_FLEET',
    memberLabel: 'Taxis',
    memberIdLabel: 'Vehicle Plate',
    memberOwnerLabel: 'Driver/Owner',
    memberLocationLabel: 'Zone',
    feeLabel: 'Dispatch Fee',
    routesLabel: 'Zones',
    showTLB: false,
    showRouteMap: false,
    showVehicleType: false,
  },
}

export function normalizeOperatorType(value?: string | null): OperatorType {
  const raw = (value || '').trim().toUpperCase()
  if (raw === 'MATATU_SACCO' || raw === 'MATATU_COMPANY' || raw === 'BODA_GROUP' || raw === 'TAXI_FLEET') {
    return raw as OperatorType
  }
  if (raw === 'SACCO' || raw === 'MATATU') return 'MATATU_SACCO'
  if (raw === 'BODA') return 'BODA_GROUP'
  if (raw === 'TAXI') return 'TAXI_FLEET'
  return defaultOperatorType
}

export function getOperatorConfig(value?: string | null): OperatorConfig {
  return operatorConfigs[normalizeOperatorType(value)]
}

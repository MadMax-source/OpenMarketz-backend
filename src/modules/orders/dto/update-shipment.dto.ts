import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class UpdateShipmentDto {
  @IsIn(['PACKED', 'HANDED_OVER', 'IN_TRANSIT'])
  status!: 'PACKED' | 'HANDED_OVER' | 'IN_TRANSIT';

  @IsOptional()
  @IsIn(['dropoff', 'pickup'])
  method?: 'dropoff' | 'pickup';

  @IsOptional()
  @IsString()
  @Length(1, 191)
  hub?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  carrier?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  waybill?: string;

  @IsOptional()
  @IsString()
  @Length(1, 191)
  trackingUrl?: string;
}

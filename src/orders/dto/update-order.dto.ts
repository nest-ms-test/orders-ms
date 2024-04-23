import { IsEnum, IsUUID } from 'class-validator';
import { UUID } from 'crypto';
import { OrderStatus } from '@prisma/client';

export class UpdateOrderDto {
  @IsUUID()
  id: UUID;

  @IsEnum(OrderStatus)
  status: OrderStatus;
}

import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto, PaidOrderDto, UpdateOrderDto } from './dto';
import { NATS_SERVICE } from 'src/config';
import { firstValueFrom } from 'rxjs';
import { OrderWithProducts } from './interfaces';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(NATS_SERVICE) private readonly serviceClient: ClientProxy,
  ) {
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to the database');
  }

  async create(createOrderDto: CreateOrderDto) {
    const { items } = createOrderDto;

    try {
      const productIds = items.map((item) => item.productId);

      const products = await firstValueFrom(
        this.serviceClient.send({ cmd: 'validate-products' }, productIds),
      );

      const totalAmount = items.reduce((total, orderItem) => {
        const price = products.find(
          (product: { id: number; price: number }) =>
            product.id === orderItem.productId,
        ).price;

        return total + price * orderItem.quantity;
      }, 0);

      const totalItems = items.reduce(
        (total, orderItem) => total + orderItem.quantity,
        0,
      );

      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          OrderItem: {
            createMany: {
              data: items.map((orderItem) => ({
                productId: orderItem.productId,
                price: products.find(
                  (product) => product.id === orderItem.productId,
                ).price,
                quantity: orderItem.quantity,
              })),
            },
          },
        },
        include: {
          OrderItem: {
            select: {
              productId: true,
              quantity: true,
              price: true,
            },
          },
        },
      });

      return {
        ...order,
        orderItem: order.OrderItem.map((item) => ({
          ...item,
          name: products.find((product) => product.id === item.productId).name,
        })),
      };
    } catch (error) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: 'Invalid products provided',
      });
    }
  }

  async findAll(ordenPaginationDto: OrderPaginationDto) {
    const { page, limit, status } = ordenPaginationDto;

    const totalRows = await this.order.count({ where: { status } });
    const lastPage = Math.ceil(totalRows / limit);
    const orders = await this.order.findMany({
      where: { status },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: orders,
      meta: {
        page,
        totalRows,
        lastPage,
      },
    };
  }

  async findOne(id: string) {
    const order = await this.order.findUnique({
      where: { id },
      include: {
        OrderItem: {
          select: {
            productId: true,
            quantity: true,
            price: true,
          },
        },
      },
    });

    if (!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with ID ${id} not found`,
      });
    }

    const productIds = order.OrderItem.map((item) => item.productId);
    const products = await firstValueFrom(
      this.serviceClient.send({ cmd: 'validate-products' }, productIds),
    );

    return {
      ...order,
      orderItem: order.OrderItem.map((item) => ({
        ...item,
        name: products.find((product) => product.id === item.productId).name,
      })),
    };
  }

  async changeOrderStatus(updateOrderDto: UpdateOrderDto) {
    const { id, status } = updateOrderDto;
    try {
      return await this.order.update({
        where: { id },
        data: { status },
      });
    } catch (error) {
      return this.handleError(error.code);
    }
  }

  async createPaymentSession(order: OrderWithProducts) {
    const paymentSession = await firstValueFrom(
      this.serviceClient.send(
        { cmd: 'create-payment-session' },
        {
          orderId: order.id,
          currency: 'usd',
          items: order.orderItem.map((item) => ({
            name: item.name,
            price: item.price,
            quantity: item.quantity,
          })),
        },
      ),
    );

    return paymentSession;
  }

  async orderPaymentSuccess(orderPaymentSuccess: PaidOrderDto) {
    this.logger.log(`Order payment success: ${orderPaymentSuccess.orderId}`);

    const orderUpdated = await this.order.update({
      where: { id: orderPaymentSuccess.orderId },
      data: {
        status: 'PAID',
        paid: true,
        paidAt: new Date(),
        stripeChargeId: orderPaymentSuccess.stripePaymentId,

        // relation
        OrderReceipt: {
          create: {
            receiptUrl: orderPaymentSuccess.receipUrl,
          },
        },
      },
    });

    return orderUpdated;
  }

  private handleError(errorCode: string) {
    if (errorCode === 'P2025') {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order not found`,
      });
    }

    throw new RpcException({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: `Internal server error`,
    });
  }
}

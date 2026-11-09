import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Socket } from 'socket.io';

@Injectable()
export class RealtimeThrottlerGuard extends ThrottlerGuard {
  protected getRequestResponse(context: ExecutionContext) {
    if (context.getType() !== 'ws') {
      return super.getRequestResponse(context);
    }

    const client = context.switchToWs().getClient<Socket>();
    return {
      req: {
        ip: client.handshake.address,
        headers: client.handshake.headers,
      },
      res: {},
    };
  }
}

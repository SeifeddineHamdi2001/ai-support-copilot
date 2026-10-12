import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AgentDto } from './dto/agent.dto';

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<AgentDto[]> {
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true, name: true, role: true, isActive: true },
      orderBy: { name: 'asc' },
    });
  }
}

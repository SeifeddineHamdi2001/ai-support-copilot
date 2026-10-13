import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AgentDto } from './dto/agent.dto';
import type { AuthUser } from '../../common/auth/auth';

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(current: AuthUser): Promise<AgentDto[]> {
    return this.prisma.user.findMany({
      where: current.role === 'AGENT' ? { id: current.id, isActive: true } : { isActive: true },
      select: { id: true, email: true, name: true, role: true, isActive: true },
      orderBy: { name: 'asc' },
    });
  }
}

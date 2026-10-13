import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hashPassword } from '../auth/auth.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async create(dto: CreateUserDto) {
    const passwordHash = await hashPassword(dto.password);
    try {
      return await this.prisma.user.create({
        data: { name: dto.name, email: dto.email.toLowerCase(), role: dto.role, passwordHash },
        select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw new ConflictException('A user with this email already exists.');
      throw error;
    }
  }

  async update(dto: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { id: dto.id },
      select: { id: true, role: true, isActive: true },
    });
    if (!existing) throw new NotFoundException('User not found.');
    const removingAdmin =
      existing.role === 'ADMIN' &&
      existing.isActive &&
      ((dto.role !== undefined && dto.role !== 'ADMIN') || dto.isActive === false);
    if (removingAdmin) {
      const otherAdmins = await this.prisma.user.count({
        where: { id: { not: dto.id }, role: 'ADMIN', isActive: true },
      });
      if (!otherAdmins)
        throw new ConflictException('At least one active administrator must remain.');
    }
    return this.prisma.user.update({
      where: { id: dto.id },
      data: {
        ...(dto.role ? { role: dto.role } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });
  }
}

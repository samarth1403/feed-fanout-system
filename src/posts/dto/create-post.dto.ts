import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePostDto {
  @IsUUID()
  @IsNotEmpty()
  authorId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  content!: string;
}

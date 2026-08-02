import { Module } from "@nestjs/common";
import { ProjectsController } from "./projects.controller.js";
import { ProjectsService } from "./projects.service.js";
import { AuthModule } from "../common/auth/auth.module.js";
import { ConflictsModule } from "../conflicts/conflicts.module.js";

// Imports ConflictsModule (which exports ConflictsService) so the conflict
// resolve route can live on ProjectsController at its legacy nested path.
// One-way dependency: ConflictsModule/ConflictsService never imports
// ProjectsModule/ProjectsService, so this does not create a cycle.
@Module({
  imports: [AuthModule, ConflictsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}

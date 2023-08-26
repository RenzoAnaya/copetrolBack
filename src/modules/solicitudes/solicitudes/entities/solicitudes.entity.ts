import { BaseEntity } from '../../../../config/base.entity';
import { Column, Entity, JoinColumn, OneToMany, OneToOne } from 'typeorm';
import { ISolicitudRecoleccion } from '../../../../interfaces/solicitudes/solicitudRecoleccion.interface';
import { TrackerEntity } from '../../tracker/entities/tracker.entity';
import { ResiduosRecojoEntity } from '../../residuosRecojo/entities/residuosRecojo.entity';

@Entity({name:'solicitudes'})
export class SolicitudesEntity extends BaseEntity implements ISolicitudRecoleccion
{
  @Column()
  fechaRecoleccion: string;

  @Column()
  fechaSolicitud: string;

  @Column()
  empresaSolicitante: number;

  @Column()
  sucursalEmpresaSolicitante: number;

  @Column({nullable: true})
  cilindros: number;

  @Column()
  direccionRecoleccion: string;

  @Column()
  contactoEmpresa: string;

  @Column()
  estadoSolicitud: number;

  @Column({nullable: true})
  observacion: string;

  @OneToOne(() => TrackerEntity)
  @JoinColumn()
  tracker: TrackerEntity;

  @OneToMany(() => ResiduosRecojoEntity, residuo => residuo.solicitud)
  residuosRecojo: ResiduosRecojoEntity[];
}
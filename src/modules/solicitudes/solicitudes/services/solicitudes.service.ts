import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeleteResult, Repository, UpdateResult } from 'typeorm';
import { SolicitudDTO, SolicitudUpdateDTO } from '../dto/solicitud.dto';
import { ErrorManager } from '../../../../utils/error.manager';
import { SolicitudesEntity } from '../entities/solicitudes.entity';
import { MailService } from '../../../mail/services/mail.service';
import { TrackerDTO } from '../../tracker/dto/tracker.dto';
import { ResiduosRecojoEntity } from '../../residuosRecojo/entities/residuosRecojo.entity';
import { ClientesService } from '../../clientes/services/clientes.service';
import { SucursalesClienteService } from '../../sucursalesCliente/services/sucursalesCliente.service';
import { VehiculosService } from '../../../mantenimiento/vehiculos/services/vehiculos.service';
import { TrackerService } from '../../tracker/services/tracker.service';
import { EtapaTrackerService } from '../../tracker/services/etapaTracker.service';
import { ClienteMailService } from '../../../mail/services/clienteMail.service';
import { ConductoresService } from '../../../mantenimiento/conductores/services/conductores.service';
import { TiposResiduoService } from '../../../mantenimiento/tiposResiduo/services/tiposResiduo.service';
import { format } from 'date-fns';
import { TransporteAsignadoService } from '../../transporteAsignado/services/transporteAsignado.service';
import { CalidadMailService } from 'src/modules/mail/services/calidadMail.service';
import { UnidadMedidaResiduoService } from 'src/modules/mantenimiento/tiposResiduo/services/unidadesMedidaResiduo.service';

@Injectable()
export class SolicitudesService{
  constructor(
    @InjectRepository(SolicitudesEntity) private readonly solicitudRespository: Repository<SolicitudesEntity>,
    @InjectRepository(ResiduosRecojoEntity) private readonly residuoRecojoRepository: Repository<ResiduosRecojoEntity>,
    private readonly clienteService: ClientesService,
    private readonly sucursalService: SucursalesClienteService,
    private readonly mailService: MailService,
    private readonly vehiculoService: VehiculosService,
    private readonly trackerService: TrackerService,
    private readonly etapaTrackerService: EtapaTrackerService,
    private readonly clienteMailService: ClienteMailService,
    private readonly calidadMailService: CalidadMailService,
    private readonly conductorService: ConductoresService,
    private readonly tipoResiduoService: TiposResiduoService,
    private readonly unidadMedidaService: UnidadMedidaResiduoService,
    private readonly transporteAsignadoService: TransporteAsignadoService,
  ){}

  public async createSolicitud(body: SolicitudDTO, tracker: TrackerDTO)
  {
    try {
      const cliente = await this.clienteService.findClienteById(body.clienteId);
      const sucursal = await this.sucursalService.findSucursalById(body.sucursalId);
      const lastRecord = await this.solicitudRespository.createQueryBuilder('solicitudes')
        .orderBy('solicitudes.id', 'DESC')
        .getOne();

      const residuosRecojo = await Promise.all(
        body.residuos.map(async (residuoRecojoDto) => {
          const tipoResiduo = await this.tipoResiduoService.findResiduoById(residuoRecojoDto.tipoResiduoId);
          const unidadMedida = await this.unidadMedidaService.findBy({
            key: 'unidadMedida',
            value: residuoRecojoDto.unidadMedida
          });
          const residuoRecojo = new ResiduosRecojoEntity();

          residuoRecojo.cantidadRecoleccion = residuoRecojoDto.cantidad;
          residuoRecojo.residuo = tipoResiduo;
          residuoRecojo.unidadMedida = residuoRecojoDto.unidadMedida;
          residuoRecojo.cantidadUniversal = unidadMedida.factorConversion * residuoRecojoDto.cantidad;
          return await this.residuoRecojoRepository.save(residuoRecojo);
        }),
      );

      const solicitudBody = {
        ...body,
        codigo: 'COPTR-'+(lastRecord ? lastRecord.id+1 : 1),
        tracker: tracker,
        residuosRecojo: residuosRecojo,
        cliente: cliente,
        sucursal: sucursal,
        fechaRecoleccion: format(new Date(body.fechaRecoleccion), 'dd-MM-yyyy')
      };

      const solicitud : SolicitudesEntity = await this.solicitudRespository.save(solicitudBody);

      return {
        state: true,
        message: "Su solicitud de recojo fue registrada con éxito, nuestro equipo se comunicará con usted.",
        solicitud: solicitud
      };
    } catch (error) {
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async reprogramarSolicitud(body)
  {
    const bodyUpdate = {
      ...new SolicitudesEntity(),
      motivoReprogramacion: body.motivo,
      fechaRecoleccion: body.nuevaFecha
    }
    const solicitud = await this.updateSolicitud(bodyUpdate, body.solicitudId);
    return {
      state: true,
      message: "Solicitud reprogramada con éxito."
    }
  }

  public async findSolicitudes(queryParams): Promise<SolicitudesEntity[]>
  {
    const query = this.solicitudRespository.createQueryBuilder('solicitudes')
      .leftJoinAndSelect('solicitudes.cliente', 'cliente')
      .leftJoinAndSelect('solicitudes.sucursal', 'sucursal')
      .leftJoinAndSelect('solicitudes.residuosRecojo', 'residuosRecojo')
      .leftJoinAndSelect('solicitudes.asignacionTransporte', 'asignacionTransporte')
      .leftJoinAndSelect('asignacionTransporte.conductorSupervisor', 'conductorSupervisor')
      .leftJoinAndSelect('asignacionTransporte.conductor', 'conductor')
      .leftJoinAndSelect('asignacionTransporte.vehiculo', 'vehiculo')
      .leftJoinAndSelect('residuosRecojo.residuo', 'residuo')
      .leftJoinAndSelect('solicitudes.tracker', 'tracker')
      .leftJoinAndSelect('tracker.etapas', 'etapas');
      
      // .orderBy('solicitudes.fechaRecoleccion', 'ASC');
    
    

    if (queryParams.estadoSolicitud && queryParams.estadoSolicitud.length > 0) {
      const valoresNumericos = queryParams.estadoSolicitud.map(Number);
      query.andWhere('solicitudes.estadoSolicitud IN (:...estadosSolicitud)', { estadosSolicitud: valoresNumericos });
      
    }
    // else{
    //   if (queryParams.estadoSolicitud) {
    //     query.andWhere('solicitudes.estadoSolicitud = :estadoSolicitud', { estadoSolicitud: queryParams.estadoSolicitud });
    //   }
    // }

    if (queryParams.clienteId) {
      query.andWhere('cliente.id = :clienteId', { clienteId: queryParams.clienteId });
    }

    if (queryParams.sucursalId) {
      query.andWhere('sucursal.id = :sucursalId', { sucursalId: queryParams.sucursalId });
    }

    // query.addSelect([
    //   `DATE_FORMAT(solicitudes.fechaRecoleccion, '%d-%m-%Y') AS formattedFechaRecoleccion`
    // ]);

    // query.orderBy('formattedFechaRecoleccion', 'ASC');

    try {
      const solicitudes: SolicitudesEntity[] = await query
     
      .getMany();
      
      return solicitudes;
    } catch (error) {
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async findSolicitudesBy(): Promise<SolicitudesEntity[]>
  {
    try {
      const solicitudes : SolicitudesEntity[] = await this.solicitudRespository.find();
      
      return solicitudes;
    } catch (error) {
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async findSolicitudById(id: number): Promise<SolicitudesEntity>
  {
    try {
      const roles : SolicitudesEntity =  await this.solicitudRespository
        .createQueryBuilder('solicitudes')
        .leftJoinAndSelect('solicitudes.tracker', 'tracker')
        .leftJoinAndSelect('solicitudes.cliente', 'cliente')
        .leftJoinAndSelect('solicitudes.sucursal', 'sucursal')
        .leftJoinAndSelect('solicitudes.residuosRecojo', 'residuosRecojo')
        .leftJoinAndSelect('solicitudes.asignacionTransporte', 'asignacionTransporte')
        .leftJoinAndSelect('residuosRecojo.residuo', 'residuo')
        .leftJoinAndSelect('tracker.etapas', 'etapas')
        .where({id})
        .getOne();

        if(!roles)
        {
          throw new ErrorManager({
            type: 'BAD_REQUEST',
            message: `No se encontró al usuario de Id = ${id}`
          });
        }

        return roles;
    } catch (error) {
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async updateSolicitud(body, id: number)
  {
    try {
      const solicitud: UpdateResult = await this.solicitudRespository.update(id, body);
      if(solicitud.affected === 0)
      {
        return {
          state: false,
          message: "No se pudo actualizar la solicitud",
          solicitud: null
        };
      }
      return {
        state: true,
        message: "Solicitud actualizada correctamente",
        solicitud: solicitud
      };
    } catch (error) {
      console.log("error en updateSolicitud")
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async deleteSolicitud(id: string): Promise<DeleteResult> | undefined
  {
    try {
      const roles: DeleteResult = await this.solicitudRespository.softDelete(id);
      if(roles.affected === 0)
      {
        throw new ErrorManager({
          type: 'BAD_REQUEST',
          message: 'No se pudo eliminar el usuario, porque no existe.'
        });
      }
      return roles;
    } catch (error) {
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async sendEmailConfirmation(){
    try {
      await this.mailService.sendUserConfirmation();
    } catch (error) {
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async findSolicitudesByClienteIdBySucursalId(clienteId: string, sucursalId: string): Promise<SolicitudesEntity[]>
  {
    try {
      const solicitudes : SolicitudesEntity[] = await this.solicitudRespository
        .createQueryBuilder('solicitudes')
        .innerJoinAndSelect('solicitudes.tracker', 'tracker')
        .leftJoinAndSelect('tracker.etapas', 'etapas')
        .where({
          empresaSolicitante: clienteId,
          sucursalEmpresaSolicitante: sucursalId
        })
        .getMany();
      
      return solicitudes;
    } catch (error) {
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async asignacionVehiculo(body: any)
  {
    const solicitudInfo = await this.findSolicitudById(body.solicitudId);
    const vehiculoInfo = await this.vehiculoService.findVehiculoById(body.vehiculoId);
    const bodyVehiculo = {
      ...vehiculoInfo,
      tipoVehiculoId: vehiculoInfo.tipoVehiculo.id,
      disponibilidad: "No disponible (programado para recojo)"
    }
    const trackerInfo = await this.trackerService.findTrackerById(solicitudInfo.tracker.id);
    const bodyTracker = {
      ...trackerInfo,
      etapaActual: "Vehículo asignado"
    }

    const etapasTracker = await this.etapaTrackerService.findEtapas({trackerId: trackerInfo.id});
    if (etapasTracker.length > 0) {
      for (const etapa of etapasTracker) {
        const bodyEtapa = {
          ...etapa,
          estado: "Finalizado"
        }
        await this.etapaTrackerService.updateEtapaTracker(bodyEtapa, bodyEtapa.id);
      }
    }
    
    try {
      const nuevaAsignacion = await this.transporteAsignadoService.createAsignacion({
        solicitudId: body.solicitudId,
        vehiculoId: body.vehiculoId
      });

      const updateSolicitud = await this.updateSolicitud({
        estadoSolicitud: 3,
        asignacionTransporte: nuevaAsignacion.asignacionTransporte
      }, body.solicitudId);
      
      const updateVehiculo = await this.vehiculoService.updateVehiculo(bodyVehiculo, body.vehiculoId);
      
      const tracker = await this.trackerService.updateTracker(bodyTracker, solicitudInfo.tracker.id);
      
      const newEtapa = await this.etapaTrackerService.createEtapaTracker(trackerInfo, 3);
      
      return {
        state: true,
        message: "La asignación de vehículo se realizó correctamente"
      };
    } catch (error) {
      console.log("Error en la asignacionVehiculo.")
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async asignacionTranportista(body: any)
  {
    const cliente = await this.clienteService.findClienteById(body.clienteId);
    const sucursal = await this.sucursalService.findSucursalById(body.sucursalId);
    const conductor = await this.conductorService.findConductorById(body.conductorId);
    const supervisor = await this.conductorService.findConductorById(body.supervisorId);
    const solicitudInfo = await this.findSolicitudById(body.solicitudId);
    const bodySolicitud = {
      estadoSolicitud: 4
    }
    const trackerInfo = await this.trackerService.findTrackerById(solicitudInfo.tracker.id);
    const bodyTracker = {
      ...trackerInfo,
      etapaActual: "Transportista asignado",
      estado: "Finalizado"
    }
    const bodyTransporteAsignado = {
      conductorId: parseInt(body.conductorId),
      supervisorId: parseInt(body.supervisorId)
    }
    
    try {
      const solicitud = await this.updateSolicitud(bodySolicitud, body.solicitudId);
      const updateTransporte = await this.transporteAsignadoService.updateTransporteAsignado(bodyTransporteAsignado, solicitudInfo.asignacionTransporte.id);
      
      const tracker = await this.trackerService.updateTracker(bodyTracker, solicitudInfo.tracker.id);
      
      const newEtapa1 = await this.etapaTrackerService.createEtapaTracker(trackerInfo, 4);
      
      const mailTransportistaAsignado = await this.clienteMailService.asignacionTransportista(cliente, sucursal, conductor, supervisor);

      return {
        state: true,
        message: "La asignación de transportista se realizó correctamente"
      };
    } catch (error) {
      console.log("Error en solicitudService - asignacionTransportista.")
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async indicarHoraCaminoRecojo(solicitudId: number)
  {
    const solicitudInfo = await this.findSolicitudById(solicitudId);
    const bodyUpdateSolicitud = {
      estadoSolicitud: 5
    };
    const bodyUpdateTracker = {
      etapaActual: "En camino a recojo",
      estado: "En proceso"
    }

    try {
      const solicitud = await this.updateSolicitud(bodyUpdateSolicitud, solicitudId);
      
      const tracker = await this.trackerService.updateTracker(bodyUpdateTracker, solicitudInfo.tracker.id);
      
      const newEtapa = await this.etapaTrackerService.createEtapaTracker(solicitudInfo.tracker, 5);

      return {
        state: true,
        message: "El registro de hora de salida se hizo correctamente."
      };
    } catch (error) {
      console.log("Error en la llegadaCliente.")
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async indicarHoraLlegadaCliente(solicitudId: number)
  {
    const solicitudInfo = await this.findSolicitudById(solicitudId);
    const bodyUpdateSolicitud = {
      estadoSolicitud: 6
    };
    const bodyUpdateTracker = {
      etapaActual: "Recolección en proceso.",
      estado: "En proceso"
    }

    try {
      const solicitud = await this.updateSolicitud(bodyUpdateSolicitud, solicitudId);
      
      const tracker = await this.trackerService.updateTracker(bodyUpdateTracker, solicitudInfo.tracker.id);
      
      const newEtapa = await this.etapaTrackerService.createEtapaTracker(solicitudInfo.tracker, 6);

      return {
        state: true,
        message: "La asignación de llegada al cliente se realizó correctamente"
      };
    } catch (error) {
      console.log("Error en la llegadaCliente.")
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async indicarHoraSalidaCliente(solicitudId: number)
  {
    const solicitudInfo = await this.findSolicitudById(solicitudId);
    const bodyUpdateSolicitud = {
      estadoSolicitud: 7
    };
    const bodyUpdateTracker = {
      etapaActual: "En camino a entrega a planta.",
      estado: "Pendiente"
    }

    try {
      const solicitud = await this.updateSolicitud(bodyUpdateSolicitud, solicitudId);
      
      const tracker = await this.trackerService.updateTracker(bodyUpdateTracker, solicitudInfo.tracker.id);
      
      const newEtapa = await this.etapaTrackerService.createEtapaTracker(solicitudInfo.tracker, 7);

      return {
        state: true,
        message: "La asignación de salida del cliente se realizó correctamente"
      };
    } catch (error) {
      console.log("Error en la salidaCliente.")
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async indicarHoraLlegadaPlanta(solicitudId: number)
  {
    const solicitudInfo = await this.findSolicitudById(solicitudId);
    const bodyUpdateSolicitud = {
      estadoSolicitud: 8
    };
    const bodyUpdateTracker = {
      etapaActual: "Residuos entregados a planta.",
      estado: "Pendiente"
    }

    try {
      const solicitud = await this.updateSolicitud(bodyUpdateSolicitud, solicitudId);
      
      const tracker = await this.trackerService.updateTracker(bodyUpdateTracker, solicitudInfo.tracker.id);
      
      const newEtapa = await this.etapaTrackerService.createEtapaTracker(solicitudInfo.tracker, 8);

      return {
        state: true,
        message: "La hora de llegada a planta se registró con éxito."
      };
    } catch (error) {
      console.log("Error en la indicarHoraLlegadaPlanta.")
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async asignarCantidadResiduo(body)
  {
    const bodyResiduoRecojo = {
      cantidadReal: body.cantidadReal,
      cantidadDesperdicio: body.cantidadDesperdicio
    }

    try {
      const response = await this.residuoRecojoRepository.update(body.residuoRecojoId, bodyResiduoRecojo);
      return {
        state: true,
        message: "La asignación de cantidad de los residuso de recojo se realizó correctamente"
      };
    } catch (error) {
      console.log("Error en la Asignación de cantidades.")
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async validarCantidadIngresadaRecepcion(solicitudId: number)
  {
    const solicitudInfo = await this.findSolicitudById(solicitudId);
    const bodyUpdateSolicitud = {
      estadoSolicitud: 9,
    };
    const bodyUpdateTracker = {
      etapaActual: "Evaluación de residuos en recepción.",
      estado: "Pendiente"
    }

    try {
      const solicitud = await this.updateSolicitud(bodyUpdateSolicitud, solicitudId);
      
      const tracker = await this.trackerService.updateTracker(bodyUpdateTracker, solicitudInfo.tracker.id);
      
      const newEtapa = await this.etapaTrackerService.createEtapaTracker(solicitudInfo.tracker, 9);

      return {
        state: true,
        message: "La asignación de cantidad de los residuos por parte de recepción se realizó correctamente"
      };
    } catch (error) {
      console.log("Error en la Asignación de recepcion.")
      throw ErrorManager.createSignatureError(error.message);
    }
  }

  public async validarCantidadIngresadaCalidad(solicitudId: number)
  {
    const solicitudInfo = await this.findSolicitudById(solicitudId);
    const bodyUpdateSolicitud = {
      estadoSolicitud: 10,
    };
    const bodyUpdateTracker = {
      etapaActual: "Residuos revisados en calidad, emisión de laboratorio.",
      estado: "Pendiente"
    }
    try {
      const solicitud = await this.updateSolicitud(bodyUpdateSolicitud, solicitudId);
      
      const tracker = await this.trackerService.updateTracker(bodyUpdateTracker, solicitudInfo.tracker.id);
      
      const newEtapa = await this.etapaTrackerService.createEtapaTracker(solicitudInfo.tracker, 10);

      const mailLastEtapa = await this.calidadMailService.informeCantidadResiduo(solicitudInfo);

      return {
        state: true,
        message: "La asignación de cantidad de los residuos por parte de recepción se realizó correctamente"
      };
    } catch (error) {
      console.log("Error en la Asignación de recepcion.")
      throw ErrorManager.createSignatureError(error.message);
    }
  }
}